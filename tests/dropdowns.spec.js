const { test, expect } = require('@playwright/test');

test.describe('Dropdown Population', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the local HTML file
    await page.goto('file://' + __dirname + '/../s/ai_prompt_creator_v11_enhanced.html');
  });

  test('should populate the style dropdown', async ({ page }) => {
    const styleDropdown = page.locator('#style');
    await expect(styleDropdown).toBeVisible();

    // Check for a specific option
    const realisticOption = styleDropdown.locator('option[value="realistic"]');
    await expect(realisticOption).toHaveText('Реалистичный (Photorealistic)');

    // Check the total number of options
    const optionsCount = await styleDropdown.locator('option').count();
    expect(optionsCount).toBe(33); // Assuming 33 styles from data.js
  });

  test('should populate the camera dropdown', async ({ page }) => {
    const cameraDropdown = page.locator('#camera');
    await expect(cameraDropdown).toBeVisible();

    // Check for a specific option
    const wideShotOption = cameraDropdown.locator('option[value="wide-shot"]');
    await expect(wideShotOption).toHaveText('Широкий план (Wide Shot)');

    // Check the total number of options
    const optionsCount = await cameraDropdown.locator('option').count();
    expect(optionsCount).toBe(32); // Assuming 32 camera options from data.js
  });

  test('should populate the lighting dropdown', async ({ page }) => {
    const lightingDropdown = page.locator('#lighting');
    await expect(lightingDropdown).toBeVisible();

    // Check for a specific option
    const naturalOption = lightingDropdown.locator('option[value="natural"]');
    await expect(naturalOption).toHaveText('Естественное (Natural Light)');

    // Check the total number of options
    const optionsCount = await lightingDropdown.locator('option').count();
    expect(optionsCount).toBe(32);
  });

  test('should populate the mood dropdown', async ({ page }) => {
    const moodDropdown = page.locator('#mood');
    await expect(moodDropdown).toBeVisible();

    // Check for a specific option
    const epicOption = moodDropdown.locator('option[value="epic"]');
    await expect(epicOption).toHaveText('Эпическое (Epic)');

    // Check the total number of options
    const optionsCount = await moodDropdown.locator('option').count();
    expect(optionsCount).toBe(32);
  });
});
