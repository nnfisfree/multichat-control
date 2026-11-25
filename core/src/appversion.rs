//! Version of a running streaming app, read from its .exe's version info.
//!
//! OBS tells its version over obs-websocket, but Streamlabs Desktop's and Meld Studio's APIs don't
//! share one, so for those we find the running program and read the same version Windows shows in
//! the file's Properties. Nothing leaves the machine.

/// "streamlabs" or "meld"; None when the app isn't running or has no version info.
#[tauri::command]
pub fn stream_app_version(app: String) -> Option<String> {
    imp::find(&app)
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// File names and full paths of running programs whose file name matches.
    fn running(matches: impl Fn(&str) -> bool) -> Vec<(String, Vec<u16>)> {
        let mut out = Vec::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return out;
            }
            let mut e: PROCESSENTRY32W = std::mem::zeroed();
            e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut ok = Process32FirstW(snap, &mut e) != 0;
            while ok {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                let name = String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase();
                if matches(&name) {
                    let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, e.th32ProcessID);
                    if !h.is_null() {
                        let mut buf = vec![0u16; 1024];
                        let mut size = buf.len() as u32;
                        if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut size) != 0 {
                            buf.truncate(size as usize);
                            buf.push(0);
                            if !out.iter().any(|(_, p)| *p == buf) {
                                out.push((name.clone(), buf));
                            }
                        }
                        CloseHandle(h);
                    }
                }
                ok = Process32NextW(snap, &mut e) != 0;
            }
            CloseHandle(snap);
        }
        out
    }

    struct Info(Vec<u8>);

    impl Info {
        fn read(path: &[u16]) -> Option<Info> {
            unsafe {
                let size = GetFileVersionInfoSizeW(path.as_ptr(), std::ptr::null_mut());
                if size == 0 {
                    return None;
                }
                let mut data = vec![0u8; size as usize];
                if GetFileVersionInfoW(path.as_ptr(), 0, size, data.as_mut_ptr() as *mut c_void) == 0 {
                    return None;
                }
                Some(Info(data))
            }
        }

        fn query(&self, key: &str) -> Option<(*const u8, u32)> {
            let mut ptr: *mut c_void = std::ptr::null_mut();
            let mut len = 0u32;
            let ok = unsafe { VerQueryValueW(self.0.as_ptr() as *const c_void, wide(key).as_ptr(), &mut ptr, &mut len) };
            (ok != 0 && !ptr.is_null() && len > 0).then_some((ptr as *const u8, len))
        }

        /// A text value such as ProductName, in the file's first language.
        fn text(&self, key: &str) -> Option<String> {
            let (p, _) = self.query("\\VarFileInfo\\Translation")?;
            let (lang, cp) = unsafe { (*(p as *const u16), *(p as *const u16).add(1)) };
            let (p, len) = self.query(&format!("\\StringFileInfo\\{lang:04x}{cp:04x}\\{key}"))?;
            let chars = unsafe { std::slice::from_raw_parts(p as *const u16, len as usize) };
            let end = chars.iter().position(|&c| c == 0).unwrap_or(chars.len());
            let s = String::from_utf16_lossy(&chars[..end]).trim().to_string();
            (!s.is_empty()).then_some(s)
        }

        fn version(&self) -> Option<String> {
            // the product version as text ("1.17.0", "1.2.0 (abc)"), keeping just the numbers
            if let Some(v) = self.text("ProductVersion").and_then(|t| tidy(&t)) {
                return Some(v);
            }
            let (p, _) = self.query("\\")?;
            let f = unsafe { &*(p as *const VS_FIXEDFILEINFO) };
            tidy(&format!("{}.{}.{}.{}", f.dwProductVersionMS >> 16, f.dwProductVersionMS & 0xffff, f.dwProductVersionLS >> 16, f.dwProductVersionLS & 0xffff))
        }
    }

    /// Leading "1.2.3" of a version text; a trailing ".0" fourth part is dropped.
    fn tidy(t: &str) -> Option<String> {
        let num: String = t.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        let mut parts: Vec<&str> = num.split('.').filter(|p| !p.is_empty()).collect();
        if parts.is_empty() || parts.iter().all(|p| *p == "0") {
            return None;
        }
        if parts.len() == 4 && parts[3] == "0" {
            parts.pop();
        }
        Some(parts.join("."))
    }

    pub fn find(app: &str) -> Option<String> {
        let (name_has, product_has): (&str, &str) = match app {
            "streamlabs" => ("streamlabs", "streamlabs"),
            // the Meld diff tool is also "Meld.exe": only take Meld Studio
            "meld" => ("meld", "meld studio"),
            _ => return None,
        };
        for (name, path) in running(|n| n.contains(name_has)) {
            let Some(info) = Info::read(&path) else { continue };
            let product = format!("{} {} {}", name, info.text("ProductName").unwrap_or_default(), info.text("FileDescription").unwrap_or_default()).to_lowercase().replace(' ', "");
            if !product.contains(&product_has.replace(' ', "")) {
                continue;
            }
            if let Some(v) = info.version() {
                return Some(v);
            }
        }
        None
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn find(_app: &str) -> Option<String> {
        None
    }
}
