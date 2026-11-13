//! Remembers where the main window was: its position, size, whether it was maximized, and on
//! which monitor. The next start puts it back exactly there. Only when that monitor is gone
//! (unplugged, switched off) does the window open on Windows' main monitor instead.
//!
//! Everything is kept in physical pixels, as Windows reports them, together with the monitor's
//! own rectangle and scale, so the monitor can be recognised and sizes converted when needed.

use crate::paths;
use crate::storage::{log, write_atomic};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

const FILE: &str = "window.json";
/// Moving or resizing sends many events: the file is written once things settle.
const SAVE_DELAY: Duration = Duration::from_millis(600);
/// How much of the window's top edge must be on a screen for it to count as reachable.
const MIN_VISIBLE: i32 = 48;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
    /// The monitor the window was on, as Windows names it (\\.\DISPLAY2).
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

/// Writes a change still waiting for its delay. Called when the app exits.
pub fn flush() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(p) = PENDING.lock().ok().and_then(|mut g| g.take()) {
        write(&p);
    }
}

/// Minimized and maximized, asked of Windows itself: Tauri's own record is updated only after
/// the move that maximizing causes, which would save the maximized size as the normal one.
fn window_state(w: &WebviewWindow) -> (bool, bool) {
    #[cfg(windows)]
    if let Ok(hwnd) = w.hwnd() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsIconic, IsZoomed};
        let h = hwnd.0 as windows_sys::Win32::Foundation::HWND;
        return unsafe { (IsIconic(h) != 0, IsZoomed(h) != 0) };
    }
    (w.is_minimized().unwrap_or(true), w.is_maximized().unwrap_or(false))
}

/// Reads the window as it is now. Minimized or hidden windows have no useful place to keep;
/// a maximized one keeps its normal size and position and only records being maximized.
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
    // Windows parks minimized windows far off screen; never keep that place.
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

/// The last place written or waiting to be written.
static LAST: Mutex<Option<Placement>> = Mutex::new(None);

/// Called on every move, resize and maximize: keeps the newest place, written after a pause.
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

/// True when the window's top strip (where it is dragged from) lies on some screen.
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

/// Size and position centred on a monitor, the saved size converted to its scale and kept
/// inside its work area.
fn centred_on(m: &Monitor, p: &Placement) -> (i32, i32, u32, u32) {
    let ratio = if p.scale > 0.0 { m.scale_factor() / p.scale } else { 1.0 };
    let area = m.work_area();
    let width = ((p.width as f64 * ratio).round() as u32).min(area.size.width);
    let height = ((p.height as f64 * ratio).round() as u32).min(area.size.height);
    let x = area.position.x + (area.size.width - width) as i32 / 2;
    let y = area.position.y + (area.size.height - height) as i32 / 2;
    (x, y, width, height)
}

/// Works out where the saved window goes on the screens there are now.
fn target(w: &WebviewWindow, p: &Placement) -> Option<(i32, i32, u32, u32)> {
    let monitors = w.available_monitors().ok()?;
    if monitors.is_empty() {
        return None;
    }
    let named = monitors.iter().find(|m| p.monitor.is_some() && m.name() == p.monitor.as_ref());
    let exact = named.filter(|m| same_rect(m, p)).or_else(|| monitors.iter().find(|m| same_rect(m, p)));
    let wanted = if exact.is_some() {
        // The same monitor, where it was: exactly the saved place.
        Some((p.x, p.y, p.width, p.height))
    } else if let Some(m) = named {
        // The same monitor, moved in the screen layout or set to another resolution:
        // the same spot on it, kept inside it.
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
    // That monitor is gone: Windows' main monitor (or the first there is) instead.
    let main = w.primary_monitor().ok().flatten().or_else(|| monitors.into_iter().next())?;
    log("window", "the saved monitor is not connected, so the window opens on the main monitor");
    Some(centred_on(&main, p))
}

/// Puts the window back where it was last time. Runs before the window is first shown.
pub fn restore(w: &WebviewWindow) {
    let Some(p) = load() else { return };
    if let Some((x, y, width, height)) = target(w, &p) {
        // Moving first lets Windows switch the window to that monitor's scale; the size is
        // set after, and the position again, so neither is rescaled afterwards.
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

/// The window's normal place, for a window that starts maximized (screen pixels).
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

/// Called right after the window is first shown. A window shown maximized would otherwise be
/// restored (un-maximized) to the default size: Windows ignores sizes given to a hidden window
/// when it remembers the normal place, so that place is handed to Windows here.
pub fn shown(w: &WebviewWindow) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowPlacement, SetWindowPlacement, WINDOWPLACEMENT};
        let Some([left, top, right, bottom]) = NORMAL_RECT.lock().ok().and_then(|mut n| n.take()) else { return };
        let Ok(hwnd) = w.hwnd() else { return };
        // Windows keeps the normal place in work-area coordinates of the window's monitor:
        // they differ from screen pixels when the taskbar sits at the top or the left.
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
