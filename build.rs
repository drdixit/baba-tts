fn main() {
    #[cfg(windows)]
    windows_build::build();
}

#[cfg(windows)]
mod windows_build {
    pub fn build() {
        let mut res = winres::WindowsResource::new();
        res.set_icon("assets/icon.ico");
        if let Err(e) = res.compile() {
            eprintln!("cargo:warning=Failed to compile Windows resources: {}", e);
        }
    }
}
