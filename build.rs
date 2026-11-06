fn main() {
    #[cfg(windows)]
    windows_build::build();
}

#[cfg(windows)]
mod windows_build {
    use std::env;
    use std::fs;
    use std::path::PathBuf;

    pub fn build() {
        let mut res = winres::WindowsResource::new();
        res.set_icon("assets/icon.ico");
        if let Err(e) = res.compile() {
            eprintln!("cargo:warning=Failed to compile Windows resources: {}", e);
        }

        // Copy architecture-matched WebView2Loader.dll to OUT_DIR and target directory
        let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
        let arch_folder = match target_arch.as_str() {
            "x86_64" => "x64",
            "x86" => "x86",
            "aarch64" => "arm64",
            _ => "x64",
        };

        let loader_src = PathBuf::from(format!("assets/{}/WebView2Loader.dll", arch_folder));
        if loader_src.exists() {
            if let Ok(out_dir) = env::var("OUT_DIR") {
                let out_path = PathBuf::from(out_dir);
                // OUT_DIR is typically target/<profile>/build/<pkg>/out
                // We copy to OUT_DIR as well as target/<profile>/
                let _ = fs::copy(&loader_src, out_path.join("WebView2Loader.dll"));
                if let Some(target_dir) = out_path.ancestors().nth(3) {
                    let _ = fs::copy(&loader_src, target_dir.join("WebView2Loader.dll"));
                }
            }
        }
    }
}
