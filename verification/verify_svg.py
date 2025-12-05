from playwright.sync_api import Page, expect, sync_playwright
import time

def verify_svg_mode(page: Page):
    # Navigate to the app
    page.goto("http://localhost:3000")

    # Wait for the SVG button to be visible
    # Using exact=True to avoid matching parent elements if any
    svg_button = page.get_by_role("button", name="SVG", exact=True)
    expect(svg_button).to_be_visible()

    # Click the SVG button
    svg_button.click()

    # Verify the UI updates
    # The button should be active (purple background)
    # Since checking class names is brittle, we'll check if the main title changed
    # Logic in App.svelte: $: mainTitleSuffix = ... (compressionMode === 'svg' ? 'SVG' : 'Slimmer');
    # So we expect "logSVG" (with "log" bold and "SVG" light)

    # Check for "SVG" text in the header
    heading = page.locator("h1")
    expect(heading).to_contain_text("SVG")

    # Check input title
    # Logic: $: inputTitle = ... (compressionMode === 'svg' ? 'SVG input' : 'Log input');
    input_title = page.get_by_role("heading", name="SVG input")
    expect(input_title).to_be_visible()

    # Input some SVG content
    input_area = page.locator("#inputLog")
    svg_content = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><style>.cls-1{fill:red;}</style><rect class="cls-1" x="10" y="10" width="80" height="80"/></svg>'
    input_area.fill(svg_content)

    # Wait for processing
    time.sleep(2) # Allow worker to process

    # Check output
    # The output should contain the optimized SVG
    output_area = page.locator("pre")
    expect(output_area).not_to_have_text("The result will appear here...")

    # Take a screenshot
    page.screenshot(path="verification/svg_mode_verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_svg_mode(page)
            print("Verification successful!")
        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="verification/failure.png")
        finally:
            browser.close()
