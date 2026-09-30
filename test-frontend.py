from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    # Listen to console logs
    page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))
    page.on("pageerror", lambda err: print(f"Browser Error: {err}"))
    
    print("Navigating...")
    page.goto('http://localhost:7061')
    page.wait_for_load_state('networkidle')
    
    print("Clicking Classic button...")
    page.click("text=Classic")
    
    print("Waiting 10 seconds to let TTS finish...")
    time.sleep(10)
    
    browser.close()
