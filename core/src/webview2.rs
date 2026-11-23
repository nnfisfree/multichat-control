//! The window is drawn by Edge WebView2, which ships with Windows 10 and 11. On the odd machine
//! without it we say so plainly and offer Microsoft's installer, instead of failing to start
//! without a word.
//!
//! Linux uses the system's WebKitGTK instead, which the package (or AppImage) brings along, so
//! there's nothing to check up front: only a start-up failure gets reported.

/// Microsoft's direct link to the WebView2 Evergreen Bootstrapper.
#[cfg(windows)]
const INSTALLER: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
/// WebView2's client id in the registry, per Microsoft's docs for this check.
#[cfg(windows)]
const CLIENT: &str = r"Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

#[cfg(windows)]
mod win {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONERROR, MB_ICONWARNING, MB_OK, MB_YESNO};

    pub fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Installed version under one registry key, if any.
    pub fn version(root: HKEY, key: &str) -> Option<String> {
        let (key, value) = (wide(key), wide("pv"));
        let mut buf = [0u16; 64];
        let mut size = std::mem::size_of_val(&buf) as u32;
        let status = unsafe { RegGetValueW(root, key.as_ptr(), value.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
        if status != 0 {
            return None;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]))
    }

    pub fn roots() -> [(HKEY, &'static str); 3] {
        [(HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\"), (HKEY_LOCAL_MACHINE, r"SOFTWARE\"), (HKEY_CURRENT_USER, r"Software\")]
    }

    pub fn ask(title: &str, text: &str) -> bool {
        let (t, m) = (wide(title), wide(text));
        unsafe { MessageBoxW(std::ptr::null_mut(), m.as_ptr(), t.as_ptr(), MB_YESNO | MB_ICONWARNING) == IDYES }
    }

    pub fn tell(title: &str, text: &str) {
        let (t, m) = (wide(title), wide(text));
        unsafe { MessageBoxW(std::ptr::null_mut(), m.as_ptr(), t.as_ptr(), MB_OK | MB_ICONERROR) };
    }

    pub fn open(url: &str) {
        let (verb, target) = (wide("open"), wide(url));
        unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), target.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
    }
}

#[cfg(any(windows, target_os = "linux"))]
const TITLE: &str = "Multichat Control";

/// Dev builds can pretend it's missing, to test the message.
#[cfg(windows)]
fn installed() -> bool {
    if cfg!(debug_assertions) && std::env::var_os("NNF_PRETEND_NO_WEBVIEW2").is_some() {
        return false;
    }
    win::roots().iter().any(|(root, prefix)| {
        win::version(*root, &format!("{prefix}{CLIENT}")).is_some_and(|v| !v.is_empty() && v != "0.0.0.0")
    })
}

/// Runs before anything else. false means the app can't run.
pub fn ensure() -> bool {
    #[cfg(windows)]
    if !installed() {
        crate::storage::log("app", "WebView2 is missing; offered Microsoft's installer");
        let text = "This app needs Microsoft Edge WebView2 to show its window. It comes with Windows 10 and 11, \
but it's missing on this PC.\n\nIt's free and made by Microsoft. Download the installer now?\n\n\
After installing it, start the app again.";
        if win::ask(TITLE, text) {
            win::open(INSTALLER);
        }
        return false;
    }
    true
}

/// Window failed to start for some other reason: say so instead of closing silently.
pub fn failed(error: &str) {
    crate::storage::log("app", &format!("could not start: {error}"));
    #[cfg(windows)]
    win::tell(TITLE, &format!("The app couldn't start.\n\n{error}\n\nIf this keeps happening, reinstalling Microsoft Edge WebView2 usually fixes it:\n{INSTALLER}"));
    #[cfg(target_os = "linux")]
    gtk_tell(&format!("The app couldn't start.\n\n{error}\n\nIf this keeps happening, make sure WebKitGTK 4.1 (webkit2gtk-4.1) is installed and up to date."));
}

#[cfg(target_os = "linux")]
fn gtk_tell(text: &str) {
    use gtk::prelude::*;
    eprintln!("{TITLE}: {text}");
    // no display to show it on: the line above (and the log) is all we can do
    if gtk::init().is_err() {
        return;
    }
    let dialog = gtk::MessageDialog::new(None::<&gtk::Window>, gtk::DialogFlags::MODAL, gtk::MessageType::Error, gtk::ButtonsType::Ok, text);
    dialog.set_title(TITLE);
    dialog.run();
    dialog.close();
}
