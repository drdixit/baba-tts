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
        let manifest = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity
    version="1.0.0.0"
    processorArchitecture="*"
    name="com.baba.tts"
    type="win32"
  />
  <description>BABA TTS</description>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2, PerMonitor</dpiAwareness>
    </windowsSettings>
  </application>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <!-- Windows 10 and Windows 11 -->
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
      <!-- Windows 8.1 -->
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}"/>
      <!-- Windows 8 -->
      <supportedOS Id="{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}"/>
      <!-- Windows 7 -->
      <supportedOS Id="{35138b9a-5d96-4fbd-8e2d-a2440225f93a}"/>
    </application>
  </compatibility>
</assembly>
"#;
        res.set_manifest(manifest);
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
