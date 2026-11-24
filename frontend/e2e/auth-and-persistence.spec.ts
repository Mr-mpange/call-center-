import { expect, test } from "@playwright/test";

function account() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { name: "E2E Operator", email: `e2e-${suffix}@example.com`, password: "StrongPass123!" };
}

test("registers, creates a contact, and sees it after navigation", async ({ page }) => {
  const user = account();
  await page.goto("/register");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("form.auth-fields")).toBeVisible();
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(user.password);
  await page.getByRole("textbox", { name: "Confirm password", exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Create Mpange account" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.goto("/contacts");
  await page.getByRole("button", { name: "Add contact" }).click();
  await page.getByLabel("Full name").last().fill("Persisted E2E Contact");
  await page.getByRole("textbox", { name: "Phone", exact: true }).fill("+255700000099");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Persisted E2E Contact", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Persisted E2E Contact", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Filter by date" })).toBeVisible();
  await page.getByRole("button", { name: "Filter by date" }).click();
  await expect(page.locator('[data-slot="calendar"]')).toBeVisible();
});

test("rejects an unauthenticated dashboard request", async ({ request }) => {
  const response = await request.get("http://127.0.0.1:3311/api/overview");
  expect(response.status()).toBe(401);
});
