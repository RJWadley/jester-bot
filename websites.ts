import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import { sleep } from "bun";

puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

const cache = new Map<string, Promise<ArrayBuffer | null>>();

export async function viewWebsite(url: string): Promise<ArrayBuffer | null> {
	const cached = cache.get(url);
	if (cached) return await cached;

	const fetcher = new Promise<ArrayBuffer | null>((resolve, reject) => {
		puppeteer.launch().then(async (browser) => {
			try {
				const page = await browser.newPage();
				await page.setViewport({
					width: 412,
					height: 915,
					deviceScaleFactor: 1,
				});
				await page.goto(url, { waitUntil: "domcontentloaded" });
				await sleep(5000);

				const result = await (await page.screenshot()).buffer;

				console.log("screenshot taken of", await page.title());

				await browser.close();

				resolve(result as ArrayBuffer);
			} catch (e) {
				console.error(e);
				resolve(null);
			}
		});
	});

	cache.set(url, fetcher);
	return await fetcher;
}
