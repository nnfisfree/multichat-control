//! Remembers where the main window was: position, size, maximized or not, and which monitor.
//! Next start puts it back exactly there. Only if that monitor is gone (unplugged, turned off)
//! does it open on the primary monitor instead.
//!
//! Everything is stored in physical pixels as Windows reports them, along with the monitor's own
//! rect and scale, so we can recognise the monitor later and convert sizes if needed.

use crate::paths;
use crate::storage::{log, write_atomic};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

const FILE: &str = "window.json";
/// Moves/resizes fire lots of events; only write the file once things settle.
const SAVE_DELAY: Duration = Duration::from_millis(600);
/// How much of the top edge has to be on a screen for the window to count as reachable.
const MIN_VISIBLE: i32 = 48;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
    /// Monitor name as Windows reports it (\\.\DISPLAY2).
    monitor: Option<String>,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
    scale: f64,
}

static PENDING: Mutex<Option<Placement>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn load() -> Option<Placement> {
    let text = std::fs::read_to_string(paths::data_dir().join(FILE)).ok()?;
    let p: Placement = serde_json::from_str(&text).ok()?;
    (p.width >= 100 && p.height >= 100).then_some(p)
}

fn write(p: &Placement) {
    if let Ok(text) = serde_json::to_string_pretty(p) {
        if let Err(e) = write_atomic(&paths::data_dir().join(FILE), &text) {
            log("window", &format!("could not save the window's place: {e}"));
        }
    }
}

/// Writes out a pending change. Called on exit.
pub fn flush() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(p) = PENDING.lock().ok().and_then(|mut g| g.take()) {
        write(&p);
    }
}

/// Asks Windows directly. Tauri only updates its own state after the move that maximizing
/// triggers, which would save the maximized size as the normal one.
fn window_state(w: &WebviewWindow) -> (bool, bool) {
    #[cfg(windows)]
    if let Ok(hwnd) = w.hwnd() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsIconic, IsZoomed};
        let h = hwnd.0 as windows_sys::Win32::Foundation::HWND;
        return unsafe { (IsIconic(h) != 0, IsZoomed(h) != 0) };
    }
    (w.is_minimized().unwrap_or(true), w.is_maximized().unwrap_or(false))
}

/// Current placement. Minimized/hidden windows have nothing worth saving; a maximized one keeps
/// its normal size and position and just records that it was maximized.
fn current(w: &WebviewWindow, last: Option<&Placement>) -> Option<Placement> {
    let (minimized, maximized) = window_state(w);
    if minimized || !w.is_visible().unwrap_or(false) {
        return None;
    }
    if maximized {
        let mut p = last?.clone();
        p.maximized = true;
        return Some(p);
    }
    let pos = w.outer_position().ok()?;
    let size = w.inner_size().ok()?;
    // Windows parks minimized windows way off screen, never save that
    if pos.x <= -30000 || pos.y <= -30000 || size.width < 100 || size.height < 100 {
        return None;
    }
    let monitor = w.current_monitor().ok().flatten();
    let (mpos, msize) = monitor.as_ref().map(|m| (*m.position(), *m.size())).unwrap_or_default();
    Some(Placement {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized: false,
        monitor: monitor.as_ref().and_then(|m| m.name().cloned()),
        monitor_x: mpos.x,
        monitor_y: mpos.y,
        monitor_width: msize.width,
        monitor_height: msize.height,
        scale: monitor.map(|m| m.scale_factor()).unwrap_or(1.0),
    })
}

/// Last placement written, or waiting to be written.
static LAST: Mutex<Option<Placement>> = Mutex::new(None);

/// Called on every move/resize/maximize. Keeps the newest placement and writes it after a pause.
pub fn changed(w: &WebviewWindow) {
    let Ok(mut last) = LAST.lock() else { return };
    let Some(p) = current(w, last.as_ref()) else { return };
    if last.as_ref() == Some(&p) {
        return;
    }
    *last = Some(p.clone());
    drop(last);
    if let Ok(mut pending) = PENDING.lock() {
        *pending = Some(p);
    }
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(SAVE_DELAY);
        if GENERATION.load(Ordering::SeqCst) == generation {
            flush();
        }
    });
}

fn same_rect(m: &Monitor, p: &Placement) -> bool {
    let (pos, size) = (m.position(), m.size());
    pos.x == p.monitor_x && pos.y == p.monitor_y && size.width == p.monitor_width && size.height == p.monitor_height
}

/// True if the window's top strip (where you drag it) is on some screen.
fn reachable(monitors: &[Monitor], x: i32, y: i32, width: u32) -> bool {
    let (left, right, top) = (x, x + width as i32, y);
    monitors.iter().any(|m| {
        let a = m.work_area();
        let (ml, mt) = (a.position.x, a.position.y);
        let (mr, mb) = (ml + a.size.width as i32, mt + a.size.height as i32);
        let overlap = right.min(mr) - left.max(ml);
        overlap >= MIN_VISIBLE.min(width as i32) && top >= mt - 8 && top + MIN_VISIBLE / 2 <= mb
    })
}

/// Centred on a monitor, with the saved size converted to its scale and kept inside its work area.
fn centred_on(m: &Monitor, p: &Placement) -> (i32, i32, u32, u32) {
    let ratio = if p.scale > 0.0 { m.scale_factor() / p.scale } else { 1.0 };
    let area = m.work_area();
    let width = ((p.width as f64 * ratio).round() as u32).min(area.size.width);
    let height = ((p.height as f64 * ratio).round() as u32).min(area.size.height);
    let x = area.position.x + (area.size.width - width) as i32 / 2;
    let y = area.position.y + (area.size.height - height) as i32 / 2;
    (x, y, width, height)
}

/// Where the saved placement should go, given the screens we have now.
fn target(w: &WebviewWindow, p: &Placement) -> Option<(i32, i32, u32, u32)> {
    let monitors = w.available_monitors().ok()?;
    if monitors.is_empty() {
        return None;
    }
    let named = monitors.iter().find(|m| p.monitor.is_some() && m.name() == p.monitor.as_ref());
    let exact = named.filter(|m| same_rect(m, p)).or_else(|| monitors.iter().find(|m| same_rect(m, p)));
    let wanted = if exact.is_some() {
        // same monitor, same spot: use it as is
        Some((p.x, p.y, p.width, p.height))
    } else if let Some(m) = named {
        // Same monitor, but moved in the layout or running a different resolution:
        // same spot on it, clamped inside.
        let area = m.work_area();
        let width = p.width.min(area.size.width);
        let height = p.height.min(area.size.height);
        let max_x = area.position.x + (area.size.width - width) as i32;
        let max_y = area.position.y + (area.size.height - height) as i32;
        let x = (m.position().x + p.x - p.monitor_x).clamp(area.position.x, max_x);
        let y = (m.position().y + p.y - p.monitor_y).clamp(area.position.y, max_y);
        Some((x, y, width, height))
    } else {
        None
    };
    if let Some((x, y, width, height)) = wanted {
        if reachable(&monitors, x, y, width) {
            return Some((x, y, width, height));
        }
    }
    // that monitor is gone, use the primary (or whatever's first)
    let main = w.primary_monitor().ok().flatten().or_else(|| monitors.into_iter().next())?;
    log("window", "the saved monitor is not connected, so the window opens on the main monitor");
    Some(centred_on(&main, p))
}

/// Wayland doesn't let apps place their own windows (the compositor decides), so only the size and
/// maximized state can come back there. GDK picks Wayland whenever it can, unless told otherwise.
fn can_position() -> bool {
    if !cfg!(target_os = "linux") {
        return true;
    }
    let backend = std::env::var("GDK_BACKEND").unwrap_or_default();
    std::env::var_os("WAYLAND_DISPLAY").is_none() || backend.split(',').next() == Some("x11")
}

/// Restores last session's placement. Runs before the window is first shown.
pub fn restore(w: &WebviewWindow) {
    let Some(p) = load() else { return };
    if !can_position() {
        let _ = w.set_size(PhysicalSize::new(p.width, p.height));
    } else if let Some((x, y, width, height)) = target(w, &p) {
        // Move first so Windows switches the window to that monitor's DPI, then set the size, then
        // the position again, so neither one gets rescaled afterwards.
        let _ = w.set_position(PhysicalPosition::new(x, y));
        let _ = w.set_size(PhysicalSize::new(width, height));
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
    if p.maximized {
        remember_normal_rect(w);
        let _ = w.maximize();
    }
    if let Ok(mut last) = LAST.lock() {
        *last = Some(p);
    }
}

/// Normal (restored) placement for a window that starts maximized, in screen pixels.
#[cfg(windows)]
static NORMAL_RECT: Mutex<Option<[i32; 4]>> = Mutex::new(None);

#[cfg(windows)]
fn remember_normal_rect(w: &WebviewWindow) {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let Ok(hwnd) = w.hwnd() else { return };
    let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    if unsafe { GetWindowRect(hwnd.0 as _, &mut r) } != 0 {
        if let Ok(mut n) = NORMAL_RECT.lock() {
            *n = Some([r.left, r.top, r.right, r.bottom]);
        }
    }
}

#[cfg(not(windows))]
fn remember_normal_rect(_: &WebviewWindow) {}

/// Called right after the window is first shown. Without this a window shown maximized would
/// un-maximize to the default size: Windows ignores sizes set on a hidden window when it records
/// the normal placement, so we hand it the placement here.
pub fn shown(w: &WebviewWindow) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowPlacement, SetWindowPlacement, WINDOWPLACEMENT};
        let Some([left, top, right, bottom]) = NORMAL_RECT.lock().ok().and_then(|mut n| n.take()) else { return };
        let Ok(hwnd) = w.hwnd() else { return };
        // Windows stores the normal placement in work-area coordinates of the window's monitor,
        // which differ from screen pixels when the taskbar is at the top or left.
        let (dx, dy) = w
            .current_monitor()
            .ok()
            .flatten()
            .map(|m| (m.work_area().position.x - m.position().x, m.work_area().position.y - m.position().y))
            .unwrap_or((0, 0));
        unsafe {
            let h = hwnd.0 as _;
            let mut wp: WINDOWPLACEMENT = std::mem::zeroed();
            wp.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
            if GetWindowPlacement(h, &mut wp) == 0 {
                return;
            }
            wp.rcNormalPosition.left = left - dx;
            wp.rcNormalPosition.top = top - dy;
            wp.rcNormalPosition.right = right - dx;
            wp.rcNormalPosition.bottom = bottom - dy;
            SetWindowPlacement(h, &wp);
        }
    }
    #[cfg(not(windows))]
    let _ = w;
}
