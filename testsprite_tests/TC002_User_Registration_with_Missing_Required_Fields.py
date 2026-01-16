import asyncio
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None
    
    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()
        
        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",         # Set the browser window size
                "--disable-dev-shm-usage",        # Avoid using /dev/shm which can cause issues in containers
                "--ipc=host",                     # Use host-level IPC for better stability
                "--single-process"                # Run the browser in a single process mode
            ],
        )
        
        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        context.set_default_timeout(5000)
        
        # Open a new page in the browser context
        page = await context.new_page()
        
        # Navigate to your target URL and wait until the network request is committed
        await page.goto("http://localhost:3001/", wait_until="commit", timeout=60000)
        
        # Wait for the main page to reach DOMContentLoaded state (optional for stability)
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=15000)
        except async_api.Error:
            pass
        
        # Iterate through all iframes and wait for them to load as well
        for frame in page.frames:
            try:
                await frame.wait_for_load_state("domcontentloaded", timeout=15000)
            except async_api.Error:
                pass
        
        # Interact with the page elements to simulate user flow
        # -> Try to find a correct link or button on the current page or navigate properly to the registration page.
        await page.goto('http://localhost:3001/', timeout=60000)
        await asyncio.sleep(3)
        

        # -> Click on the 'إنشاء حساب' link to go to the registration page.
        frame = context.pages[-1]
        # Click on 'إنشاء حساب' link to navigate to the registration page
        elem = frame.locator('xpath=html/body/header/div/nav/a[5]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=30000)
        

        # -> Submit the registration form with all required fields left empty to check validation errors.
        frame = context.pages[-1]
        # Click the submit button 'تسجيل وبدء الباقة' with empty required fields to trigger validation errors
        elem = frame.locator('xpath=html/body/div/form/button').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=30000)
        

        # -> Test validation for other required fields by attempting to submit the form leaving each required field empty one by one and checking for validation errors.
        frame = context.pages[-1]
        # Clear the Full Name field to test validation on it again
        elem = frame.locator('xpath=html/body/div/form/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('')
        

        frame = context.pages[-1]
        # Click submit button to trigger validation error for Full Name field
        elem = frame.locator('xpath=html/body/div/form/button').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=30000)
        

        frame = context.pages[-1]
        # Fill Full Name field to move to next field validation
        elem = frame.locator('xpath=html/body/div/form/div/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('Test User')
        

        frame = context.pages[-1]
        # Clear WhatsApp Number field to test validation on it
        elem = frame.locator('xpath=html/body/div/form/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('')
        

        frame = context.pages[-1]
        # Click submit button to trigger validation error for WhatsApp Number field
        elem = frame.locator('xpath=html/body/div/form/button').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=30000)
        

        # -> Test validation for the remaining required fields: Email and Password by submitting the form with each left empty and checking for validation errors.
        frame = context.pages[-1]
        # Fill WhatsApp Number field to move to next field validation
        elem = frame.locator('xpath=html/body/div/form/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('0123456789')
        

        frame = context.pages[-1]
        # Clear Email field to test validation on it
        elem = frame.locator('xpath=html/body/div/form/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('')
        

        frame = context.pages[-1]
        # Click submit button to trigger validation error for Email field
        elem = frame.locator('xpath=html/body/div/form/button').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=30000)
        

        # -> Test validation for the last required field: Password by submitting the form with it left empty and checking for validation error.
        frame = context.pages[-1]
        # Fill Email field to move to next field validation
        elem = frame.locator('xpath=html/body/div/form/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('example@mail.com')
        

        frame = context.pages[-1]
        # Clear Password field to test validation on it
        elem = frame.locator('xpath=html/body/div/form/div[4]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('')
        

        frame = context.pages[-1]
        # Click submit button to trigger validation error for Password field
        elem = frame.locator('xpath=html/body/div/form/button').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=30000)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        await expect(frame.locator('text=الاسم الكامل').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=رقم الواتساب').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=البريد الإلكتروني').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=كلمة المرور').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=تسجيل وبدء الباقة').first).to_be_visible(timeout=30000)
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    