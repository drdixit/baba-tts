fn main() {
    let manifest_dir = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("Cargo sets CARGO_MANIFEST_DIR"),
    );
    let embedded_ui = manifest_dir.join("frontend/dist/index.html");
    if !embedded_ui.is_file() {
        panic!(
            "The embedded frontend is missing at {}. Build it first with `npm ci && npm run build` from the frontend directory.",
            embedded_ui.display()
        );
    }
    println!(
        "cargo:rerun-if-changed={}",
        manifest_dir.join("frontend/dist").display()
    );
    println!("cargo:rerun-if-changed={}", embedded_ui.display());
    println!("cargo:rerun-if-changed={}", manifest_dir.join("assets/icon.ico").display());
    println!("cargo:rerun-if-changed={}", manifest_dir.join("assets/app.manifest").display());

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        windows_build::build(&manifest_dir);
    }
}

mod windows_build {
    use std::env;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    pub fn build(manifest_dir: &Path) {
        let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
        let icon_path = manifest_dir.join("assets/icon.ico");
        let manifest_path = manifest_dir.join("assets/app.manifest");

        // 1. Compile and link Windows PE Resources (RT_GROUP_ICON ID 1 and RT_MANIFEST ID 1)
        if icon_path.exists() && manifest_path.exists() {
            let rc_content = format!(
                "1 ICON \"{}\"\n1 24 \"{}\"\n",
                icon_path.to_string_lossy().replace('\\', "/"),
                manifest_path.to_string_lossy().replace('\\', "/")
            );
            let rc_file = out_dir.join("baba_resources.rc");
            let res_file = out_dir.join("baba_resources.res");
            let obj_file = out_dir.join("baba_resources.obj");

            if fs::write(&rc_file, rc_content).is_ok() {
                let rc_bin = find_bin(&["llvm-rc-21", "llvm-rc", "/usr/lib/llvm-21/bin/llvm-rc", "rc.exe"]);
                let cvtres_bin = find_bin(&["llvm-cvtres-21", "llvm-cvtres", "/usr/lib/llvm-21/bin/llvm-cvtres", "cvtres.exe"]);

                if let (Some(rc), Some(cvtres)) = (rc_bin, cvtres_bin) {
                    let rc_status = Command::new(&rc)
                        .arg(format!("/fo{}", res_file.display()))
                        .arg(&rc_file)
                        .status();

                    if let Ok(s) = rc_status {
                        if s.success() {
                            let cvtres_status = Command::new(&cvtres)
                                .arg("/machine:x64")
                                .arg(format!("/out:{}", obj_file.display()))
                                .arg(&res_file)
                                .status();

                            if let Ok(cs) = cvtres_status {
                                if cs.success() {
                                    println!("cargo:rustc-link-arg={}", obj_file.display());
                                }
                            }
                        }
                    }
                }
            }
        }

        // 2. Copy architecture-matched WebView2Loader.dll to OUT_DIR and target directory
        let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
        let arch_folder = match target_arch.as_str() {
            "x86_64" => "x64",
            "x86" => "x86",
            "aarch64" => "arm64",
            _ => "x64",
        };

        let loader_src = manifest_dir.join(format!("assets/{}/WebView2Loader.dll", arch_folder));
        if loader_src.exists() {
            let _ = fs::copy(&loader_src, out_dir.join("WebView2Loader.dll"));
            if let Some(target_dir) = out_dir.ancestors().nth(3) {
                let _ = fs::copy(&loader_src, target_dir.join("WebView2Loader.dll"));
            }
        }
    }

    fn find_bin(candidates: &[&str]) -> Option<String> {
        for candidate in candidates {
            if candidate.starts_with('/') {
                if Path::new(candidate).exists() {
                    return Some(candidate.to_string());
                }
            } else if let Ok(status) = Command::new("which").arg(candidate).output() {
                if status.status.success() {
                    let path = String::from_utf8_lossy(&status.stdout).trim().to_string();
                    if !path.is_empty() {
                        return Some(path);
                    }
                }
            }
        }
        None
    }
}
