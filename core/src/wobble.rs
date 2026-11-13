//! Wobbly window: while the window is dragged by its title bar it bends like jelly and settles
//! when let go, in the style of KDE's effect.
//!
//! Windows doesn't let an app bend its own window, so the effect is drawn on top of it: when a
//! move starts, the window's picture is taken and the real window is cloaked (hidden from view
//! but still being moved by Windows, so snapping, monitors and the saved place all keep working).
//! The picture is drawn onto a 4x4 Bezier patch whose control points hang on springs, in a
//! click-through layered window that follows along. Once the jelly settles the real window is
//! shown again, exactly where the picture ended.

use crate::storage::log;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::WebviewWindow;

static ENABLED: AtomicBool = AtomicBool::new(false);
/// 0 to 100.
static INTENSITY: AtomicU8 = AtomicU8::new(50);

/// Turns the effect on or off and sets how much it wobbles (0 to 100).
#[tauri::command]
pub fn window_wobble(enabled: bool, intensity: f64) {
    ENABLED.store(enabled, Ordering::Relaxed);
    INTENSITY.store(intensity.clamp(0.0, 100.0).round() as u8, Ordering::Relaxed);
}

#[cfg(windows)]
pub fn install(w: &WebviewWindow) {
    if let Ok(h) = w.hwnd() {
        unsafe { win::install(h.0 as isize) }
    }
}

#[cfg(not(windows))]
pub fn install(_: &WebviewWindow) {}

/// The window's picture: premultiplied BGRA, top row first.
struct Snapshot {
    w: i32,
    h: i32,
    px: Vec<u32>,
    /// Where the visible window starts inside its full rectangle, which also holds Windows'
    /// invisible resize borders.
    ox: i32,
    oy: i32,
    /// The full rectangle's size, to notice when the window is resized or snapped.
    full: (i32, i32),
}

/// Taken when a move or resize starts; used only if it turns out to be a move.
static PENDING: Mutex<Option<Snapshot>> = Mutex::new(None);
/// Where the mouse held the window when the move started, from the full rectangle's corner.
static CURSOR: Mutex<(i32, i32)> = Mutex::new((0, 0));
/// The running picture's offset inside the full rectangle (see Snapshot).
static OFFSET: Mutex<(i32, i32)> = Mutex::new((0, 0));
/// An animation thread is running.
static RUNNING: AtomicBool = AtomicBool::new(false);
/// The title bar is held.
static DRAGGING: AtomicBool = AtomicBool::new(false);
/// Where the window was grabbed, from its top-left corner, in pixels.
static GRAB: Mutex<(f32, f32)> = Mutex::new((0.0, 0.0));

/// The jelly: 4x4 control points on springs, each pulled toward its place on the real window.
struct Jelly {
    w: f32,
    h: f32,
    pos: [[(f32, f32); 4]; 4],
    vel: [[(f32, f32); 4]; 4],
    k: f32,
    damp: f32,
    link: f32,
    max: f32,
}

impl Jelly {
    fn new(w: i32, h: i32, x: f32, y: f32, intensity: u8) -> Self {
        let s = intensity as f32 / 100.0;
        let (w, h) = (w as f32, h as f32);
        let k = 380.0 - 230.0 * s;
        let zeta = 0.4 - 0.22 * s;
        let mut j = Jelly {
            w,
            h,
            pos: [[(0.0, 0.0); 4]; 4],
            vel: [[(0.0, 0.0); 4]; 4],
            k,
            damp: 2.0 * k.sqrt() * zeta,
            link: 0.55 * k,
            max: ((0.05 + 0.2 * s) * w.max(h)).min(420.0),
        };
        for r in 0..4 {
            for c in 0..4 {
                j.pos[r][c] = j.rest(r, c, x, y);
            }
        }
        j
    }

    fn rest(&self, r: usize, c: usize, x: f32, y: f32) -> (f32, f32) {
        (x + self.w * c as f32 / 3.0, y + self.h * r as f32 / 3.0)
    }

    /// One fixed step. (x, y) is the real window's top-left corner.
    fn step(&mut self, dt: f32, x: f32, y: f32, held: Option<(f32, f32)>) {
        let old = self.pos;
        for r in 0..4 {
            for c in 0..4 {
                let (tx, ty) = self.rest(r, c, x, y);
                let (px, py) = old[r][c];
                let mut fx = self.k * (tx - px) - self.damp * self.vel[r][c].0;
                let mut fy = self.k * (ty - py) - self.damp * self.vel[r][c].1;
                // Neighbours pull each other back to their usual spacing, which makes it jelly.
                // The diagonal ones keep it from shearing apart, so it moves as one piece.
                for (dr, dc, f) in NEIGHBOURS {
                    let (nr, nc) = (r as i32 + dr, c as i32 + dc);
                    if !(0..4).contains(&nr) || !(0..4).contains(&nc) {
                        continue;
                    }
                    let (nx, ny) = old[nr as usize][nc as usize];
                    fx += f * self.link * ((nx - px) - self.w * dc as f32 / 3.0);
                    fy += f * self.link * ((ny - py) - self.h * dr as f32 / 3.0);
                }
                let v = &mut self.vel[r][c];
                v.0 += fx * dt;
                v.1 += fy * dt;
                let p = &mut self.pos[r][c];
                p.0 += v.0 * dt;
                p.1 += v.1 * dt;
                // The part under the mouse sticks to it; the further away, the more it trails.
                if let Some((gx, gy)) = held {
                    let dx = (c as f32 / 3.0) - gx / self.w;
                    let dy = (r as f32 / 3.0) - gy / self.h;
                    let a = (-(dx * dx + dy * dy) / 0.09).exp();
                    let a = 1.0 - (1.0 - a).powf(dt * 240.0);
                    p.0 += (tx - p.0) * a;
                    p.1 += (ty - p.1) * a;
                    v.0 *= 1.0 - a;
                    v.1 *= 1.0 - a;
                }
                let (ox, oy) = (p.0 - tx, p.1 - ty);
                let d = (ox * ox + oy * oy).sqrt();
                if d > self.max {
                    p.0 = tx + ox * self.max / d;
                    p.1 = ty + oy * self.max / d;
                }
            }
        }
    }

    fn settled(&self, x: f32, y: f32) -> bool {
        (0..16).all(|i| {
            let (r, c) = (i / 4, i % 4);
            let (tx, ty) = self.rest(r, c, x, y);
            let (p, v) = (self.pos[r][c], self.vel[r][c]);
            (p.0 - tx).abs() < 0.5 && (p.1 - ty).abs() < 0.5 && v.0.abs() < 8.0 && v.1.abs() < 8.0
        })
    }

    fn snap(&mut self, x: f32, y: f32) {
        for r in 0..4 {
            for c in 0..4 {
                self.pos[r][c] = self.rest(r, c, x, y);
                self.vel[r][c] = (0.0, 0.0);
            }
        }
    }

    /// The surface point at (u, v), both 0 to 1.
    fn at(&self, u: f32, v: f32) -> (f32, f32) {
        let b = |t: f32| {
            let m = 1.0 - t;
            [m * m * m, 3.0 * t * m * m, 3.0 * t * t * m, t * t * t]
        };
        let (bu, bv) = (b(u), b(v));
        let (mut x, mut y) = (0.0, 0.0);
        for r in 0..4 {
            for c in 0..4 {
                let f = bv[r] * bu[c];
                x += f * self.pos[r][c].0;
                y += f * self.pos[r][c].1;
            }
        }
        (x, y)
    }
}

/// Each control point's neighbours, and how strongly each pulls.
const NEIGHBOURS: [(i32, i32, f32); 8] = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0), (-1, -1, 0.5), (-1, 1, 0.5), (1, -1, 0.5), (1, 1, 0.5)];

/// How finely the surface is cut into triangles for drawing.
const GRID: usize = 20;

/// Draws the picture onto the bent surface. `ox, oy` is the canvas's top-left on screen.
fn render(j: &Jelly, snap: &Snapshot, out: &mut [u32], cw: i32, ch: i32, ox: f32, oy: f32) {
    out.fill(0);
    let mut verts = vec![(0.0f32, 0.0f32); (GRID + 1) * (GRID + 1)];
    for r in 0..=GRID {
        for c in 0..=GRID {
            let (x, y) = j.at(c as f32 / GRID as f32, r as f32 / GRID as f32);
            verts[r * (GRID + 1) + c] = (x - ox, y - oy);
        }
    }
    let (sw, sh) = (snap.w as f32, snap.h as f32);
    for r in 0..GRID {
        for c in 0..GRID {
            let i = r * (GRID + 1) + c;
            let p = [verts[i], verts[i + 1], verts[i + GRID + 1], verts[i + GRID + 2]];
            let (u0, u1) = (sw * c as f32 / GRID as f32, sw * (c + 1) as f32 / GRID as f32);
            let (v0, v1) = (sh * r as f32 / GRID as f32, sh * (r + 1) as f32 / GRID as f32);
            let t = [(u0, v0), (u1, v0), (u0, v1), (u1, v1)];
            triangle([p[0], p[1], p[2]], [t[0], t[1], t[2]], snap, out, cw, ch);
            triangle([p[1], p[3], p[2]], [t[1], t[3], t[2]], snap, out, cw, ch);
        }
    }
}

/// Fills one triangle with the picture, mapped flatly across it and sampled smoothly.
fn triangle(p: [(f32, f32); 3], t: [(f32, f32); 3], snap: &Snapshot, out: &mut [u32], cw: i32, ch: i32) {
    let area = (p[1].0 - p[0].0) * (p[2].1 - p[0].1) - (p[2].0 - p[0].0) * (p[1].1 - p[0].1);
    if area.abs() < 1e-3 {
        return;
    }
    let inv = 1.0 / area;
    let x0 = p.iter().map(|q| q.0).fold(f32::MAX, f32::min).floor().max(0.0) as i32;
    let x1 = p.iter().map(|q| q.0).fold(f32::MIN, f32::max).ceil().min(cw as f32 - 1.0) as i32;
    let y0 = p.iter().map(|q| q.1).fold(f32::MAX, f32::min).floor().max(0.0) as i32;
    let y1 = p.iter().map(|q| q.1).fold(f32::MIN, f32::max).ceil().min(ch as f32 - 1.0) as i32;
    // Edge functions, as planes: w_i(x, y) = a_i x + b_i y + c_i, scaled so they add up to 1.
    let edge = |a: (f32, f32), b: (f32, f32)| {
        let (ea, eb) = ((a.1 - b.1) * inv, (b.0 - a.0) * inv);
        (ea, eb, (a.0 * b.1 - a.1 * b.0) * inv)
    };
    let e = [edge(p[1], p[2]), edge(p[2], p[0]), edge(p[0], p[1])];
    // The picture's coordinates as planes over the screen.
    let plane = |f: fn((f32, f32)) -> f32| {
        let (a, b, c) = (f(t[0]), f(t[1]), f(t[2]));
        (a * e[0].0 + b * e[1].0 + c * e[2].0, a * e[0].1 + b * e[1].1 + c * e[2].1, a * e[0].2 + b * e[1].2 + c * e[2].2)
    };
    let su = plane(|q| q.0);
    let sv = plane(|q| q.1);
    const EPS: f32 = -1e-4;
    for y in y0..=y1 {
        let fy = y as f32 + 0.5;
        let row = (y * cw) as usize;
        for x in x0..=x1 {
            let fx = x as f32 + 0.5;
            if e[0].0 * fx + e[0].1 * fy + e[0].2 < EPS || e[1].0 * fx + e[1].1 * fy + e[1].2 < EPS || e[2].0 * fx + e[2].1 * fy + e[2].2 < EPS {
                continue;
            }
            let u = su.0 * fx + su.1 * fy + su.2 - 0.5;
            let v = sv.0 * fx + sv.1 * fy + sv.2 - 0.5;
            out[row + x as usize] = sample(snap, u, v);
        }
    }
}

/// The picture's colour between pixels, blended from the four around it.
#[inline]
fn sample(s: &Snapshot, u: f32, v: f32) -> u32 {
    let u = u.clamp(0.0, (s.w - 1) as f32);
    let v = v.clamp(0.0, (s.h - 1) as f32);
    let (x, y) = (u as i32, v as i32);
    let (x2, y2) = ((x + 1).min(s.w - 1), (y + 1).min(s.h - 1));
    let fx = ((u - x as f32) * 256.0) as u32;
    let fy = ((v - y as f32) * 256.0) as u32;
    let at = |xx: i32, yy: i32| s.px[(yy * s.w + xx) as usize];
    if fx == 0 && fy == 0 {
        return at(x, y);
    }
    let (a, b, c, d) = (at(x, y), at(x2, y), at(x, y2), at(x2, y2));
    let mix = |p: u32, q: u32, f: u32| {
        let rb = (((p & 0x00ff00ff) * (256 - f) + (q & 0x00ff00ff) * f) >> 8) & 0x00ff00ff;
        let ag = ((((p >> 8) & 0x00ff00ff) * (256 - f) + ((q >> 8) & 0x00ff00ff) * f)) & 0xff00ff00;
        rb | ag
    };
    mix(mix(a, b, fx), mix(c, d, fx), fy)
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::c_void;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{GetLastError, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
    use windows_sys::Win32::Graphics::Dwm::{DwmFlush, DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWA_CLOAK, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject, AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS, HDC, SRCCOPY,
    };
    use windows_sys::Win32::Storage::Xps::PrintWindow;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos, GetWindowRect, IsIconic, IsZoomed, PeekMessageW, RegisterClassExW,
        ShowWindow, TranslateMessage, UpdateLayeredWindow, MSG, PM_REMOVE, SW_SHOWNOACTIVATE, ULW_ALPHA, WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_MOVING,
        WM_SIZING, WNDCLASSEXW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
    };

    /// Draws the window's full content, including the web page, into the picture.
    const PW_RENDERFULLCONTENT: u32 = 2;

    pub unsafe fn install(h: isize) {
        SetWindowSubclass(h as HWND, Some(proc), 0x0b0b, 0);
    }

    fn rect(h: HWND) -> RECT {
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        unsafe { GetWindowRect(h, &mut r) };
        r
    }

    unsafe extern "system" fn proc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _: usize, _: usize) -> LRESULT {
        match msg {
            WM_ENTERSIZEMOVE => {
                *PENDING.lock().unwrap() = None;
                let r = rect(h);
                let mut c = POINT { x: 0, y: 0 };
                GetCursorPos(&mut c);
                *CURSOR.lock().unwrap() = (c.x - r.left, c.y - r.top);
                // Grabbed again while it still settles: the picture on screen is reused.
                if ENABLED.load(Ordering::Relaxed) && !RUNNING.load(Ordering::Acquire) && IsZoomed(h) == 0 && IsIconic(h) == 0 {
                    let t = Instant::now();
                    if let Some(s) = capture(h) {
                        let ms = t.elapsed().as_millis();
                        if ms > 40 {
                            log("wobble", &format!("taking the window's picture took {ms} ms"));
                        }
                        *PENDING.lock().unwrap() = Some(s);
                    }
                }
            }
            // A resize, not a move.
            WM_SIZING => *PENDING.lock().unwrap() = None,
            WM_MOVING => {
                let (gx, gy) = *CURSOR.lock().unwrap();
                if RUNNING.load(Ordering::Acquire) && !DRAGGING.load(Ordering::Relaxed) {
                    let (ox, oy) = *OFFSET.lock().unwrap();
                    *GRAB.lock().unwrap() = ((gx - ox) as f32, (gy - oy) as f32);
                    DRAGGING.store(true, Ordering::Relaxed);
                } else if let Some(snap) = PENDING.lock().unwrap().take() {
                    *GRAB.lock().unwrap() = ((gx - snap.ox) as f32, (gy - snap.oy) as f32);
                    *OFFSET.lock().unwrap() = (snap.ox, snap.oy);
                    DRAGGING.store(true, Ordering::Relaxed);
                    if !RUNNING.swap(true, Ordering::AcqRel) {
                        let main = h as isize;
                        std::thread::spawn(move || {
                            animate(main, snap);
                            RUNNING.store(false, Ordering::Release);
                        });
                    }
                }
            }
            WM_EXITSIZEMOVE => {
                *PENDING.lock().unwrap() = None;
                DRAGGING.store(false, Ordering::Relaxed);
            }
            _ => {}
        }
        DefSubclassProc(h, msg, wp, lp)
    }

    struct Canvas {
        dc: HDC,
        bmp: *mut c_void,
        bits: *mut u32,
    }

    unsafe fn canvas(w: i32, h: i32) -> Option<Canvas> {
        let mut bi: BITMAPINFO = std::mem::zeroed();
        bi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..std::mem::zeroed()
        };
        let dc = CreateCompatibleDC(null_mut());
        let mut bits: *mut c_void = null_mut();
        let bmp = CreateDIBSection(dc, &bi, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
        if bmp.is_null() || bits.is_null() {
            DeleteDC(dc);
            return None;
        }
        SelectObject(dc, bmp);
        Some(Canvas { dc, bmp, bits: bits as *mut u32 })
    }

    unsafe fn free(c: Canvas) {
        DeleteDC(c.dc);
        DeleteObject(c.bmp);
    }

    /// Takes the window's picture, rounded like a Windows 11 window and as see-through as the
    /// window is set to be.
    unsafe fn capture(h: HWND) -> Option<Snapshot> {
        let r = rect(h);
        let (fw, fh) = (r.right - r.left, r.bottom - r.top);
        // Only the part that shows on screen.
        let mut v = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS as _, &mut v as *mut RECT as *mut c_void, std::mem::size_of::<RECT>() as u32) < 0 || v.right <= v.left {
            v = r;
        }
        let (ox, oy) = ((v.left - r.left).clamp(0, fw), (v.top - r.top).clamp(0, fh));
        let (w, hh) = ((v.right - v.left).min(fw - ox), (v.bottom - v.top).min(fh - oy));
        if w <= 0 || hh <= 0 || w > 8192 || hh > 8192 {
            return None;
        }
        let c = canvas(fw, fh)?;
        let n = (fw * fh) as usize;
        let mut ok = PrintWindow(h, c.dc, PW_RENDERFULLCONTENT) != 0;
        let px = std::slice::from_raw_parts(c.bits, n);
        // Some setups give back an empty picture; then it's copied from the screen instead.
        if !ok || px.iter().step_by(97).all(|p| p & 0x00ff_ffff == 0) {
            let screen = GetDC(null_mut());
            ok = BitBlt(c.dc, 0, 0, fw, fh, screen, r.left, r.top, SRCCOPY) != 0;
            ReleaseDC(null_mut(), screen);
        }
        let all = std::slice::from_raw_parts(c.bits, n);
        let mut out = Vec::with_capacity((w * hh) as usize);
        for y in oy..oy + hh {
            out.extend_from_slice(&all[(y * fw + ox) as usize..(y * fw + ox + w) as usize]);
        }
        free(c);
        if !ok {
            return None;
        }
        let alpha = crate::window::alpha() as u32;
        let radius = 8.0 * GetDpiForWindow(h) as f32 / 96.0;
        for y in 0..hh {
            for x in 0..w {
                let mut a = alpha;
                // Rounded corners.
                let cx = if (x as f32) < radius { radius - x as f32 - 0.5 } else if (x as f32) >= w as f32 - radius { x as f32 + 0.5 - (w as f32 - radius) } else { 0.0 };
                let cy = if (y as f32) < radius { radius - y as f32 - 0.5 } else if (y as f32) >= hh as f32 - radius { y as f32 + 0.5 - (hh as f32 - radius) } else { 0.0 };
                if cx > 0.0 && cy > 0.0 {
                    let d = (cx * cx + cy * cy).sqrt() - radius;
                    a = (a as f32 * (0.5 - d).clamp(0.0, 1.0)) as u32;
                }
                let p = &mut out[(y * w + x) as usize];
                let (b, g, rr) = (*p & 0xff, (*p >> 8) & 0xff, (*p >> 16) & 0xff);
                *p = (a << 24) | ((rr * a / 255) << 16) | ((g * a / 255) << 8) | (b * a / 255);
            }
        }
        Some(Snapshot { w, h: hh, px: out, ox, oy, full: (fw, fh) })
    }

    unsafe fn cloak(h: HWND, on: bool) {
        let v: i32 = on as i32;
        DwmSetWindowAttribute(h, DWMWA_CLOAK as _, &v as *const i32 as *const c_void, 4);
    }

    unsafe extern "system" fn overlay_proc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        DefWindowProcW(h, msg, wp, lp)
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    fn animate(main: isize, snap: Snapshot) {
        unsafe { run(main as HWND, snap) }
    }

    unsafe fn run(main: HWND, snap: Snapshot) {
        let class = wide("MultichatWobble");
        let module = GetModuleHandleW(null());
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(overlay_proc),
            hInstance: module,
            lpszClassName: class.as_ptr(),
            ..std::mem::zeroed()
        };
        // Already registered after the first drag: that's fine.
        RegisterClassExW(&wc);
        let r = rect(main);
        let mut jelly = Jelly::new(snap.w, snap.h, (r.left + snap.ox) as f32, (r.top + snap.oy) as f32, INTENSITY.load(Ordering::Relaxed));
        let margin = jelly.max.ceil() as i32 + 2;
        let (cw, ch) = (snap.w + 2 * margin, snap.h + 2 * margin);
        let overlay = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
            class.as_ptr(),
            null(),
            WS_POPUP,
            r.left + snap.ox - margin,
            r.top + snap.oy - margin,
            cw,
            ch,
            // Not owned by the main window: cloaking the window would hide it too.
            null_mut(),
            null_mut(),
            module,
            null(),
        );
        let Some(c) = (if overlay.is_null() { None } else { canvas(cw, ch) }) else {
            if !overlay.is_null() {
                DestroyWindow(overlay);
            }
            log("wobble", "could not create the overlay");
            return;
        };
        let out = std::slice::from_raw_parts_mut(c.bits, (cw * ch) as usize);
        let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: AC_SRC_ALPHA as u8 };
        let size = SIZE { cx: cw, cy: ch };
        let zero = POINT { x: 0, y: 0 };

        let started = Instant::now();
        let mut last = Instant::now();
        let mut released: Option<Instant> = None;
        let mut first = true;
        let mut cloaked = false;
        let (mut frames, mut draw_time) = (0u32, Duration::ZERO);
        let mut carry = 0.0f32;
        const STEP: f32 = 1.0 / 240.0;
        loop {
            let mut m: MSG = std::mem::zeroed();
            while PeekMessageW(&mut m, null_mut(), 0, 0, PM_REMOVE) != 0 {
                TranslateMessage(&m);
                DispatchMessageW(&m);
            }
            let now = Instant::now();
            carry = (carry + (now - last).as_secs_f32()).min(0.1);
            last = now;
            let r = rect(main);
            // Snapped, maximized or moved to a screen with another scale: the picture no longer fits.
            if (r.right - r.left, r.bottom - r.top) != snap.full || IsIconic(main) != 0 {
                break;
            }
            let (vx, vy) = (r.left + snap.ox, r.top + snap.oy);
            let (x, y) = (vx as f32, vy as f32);
            let dragging = DRAGGING.load(Ordering::Relaxed);
            if !dragging && released.is_none() {
                released = Some(now);
                // Let go: the real window comes back at once under the picture, almost fully
                // see-through, so it can be clicked, scrolled and typed in while the jelly settles.
                if cloaked {
                    crate::window::veil(main as isize, true);
                    cloak(main, false);
                    cloaked = false;
                }
            } else if dragging {
                released = None;
            }
            let held = dragging.then(|| *GRAB.lock().unwrap());
            while carry >= STEP {
                jelly.step(STEP, x, y, held);
                carry -= STEP;
            }
            let done = !dragging && (jelly.settled(x, y) || released.is_some_and(|t| now - t > Duration::from_secs(4)));
            if done {
                jelly.snap(x, y);
            }
            let t = Instant::now();
            let (ox, oy) = (vx - margin, vy - margin);
            render(&jelly, &snap, out, cw, ch, ox as f32, oy as f32);
            draw_time += t.elapsed();
            frames += 1;
            let at = POINT { x: ox, y: oy };
            let drawn = UpdateLayeredWindow(overlay, null_mut(), &at, &size, c.dc, &zero, 0, &blend, ULW_ALPHA);
            if first {
                if drawn == 0 {
                    log("wobble", &format!("drawing failed ({})", GetLastError()));
                }
                first = false;
                ShowWindow(overlay, SW_SHOWNOACTIVATE);
                DwmFlush();
                cloak(main, true);
                cloaked = true;
            }
            if done {
                break;
            }
            if DwmFlush() < 0 {
                std::thread::sleep(Duration::from_millis(8));
            }
        }
        // The real window comes back before the picture goes, so nothing flickers.
        if cloaked {
            cloak(main, false);
        }
        crate::window::veil(main as isize, false);
        DwmFlush();
        DwmFlush();
        DestroyWindow(overlay);
        free(c);
        if frames > 0 {
            log("wobble", &format!("{} frames in {:.1} s, {:.1} ms each to draw", frames, started.elapsed().as_secs_f32(), draw_time.as_secs_f32() * 1000.0 / frames as f32));
        }
    }
}
