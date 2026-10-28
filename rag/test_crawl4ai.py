
import asyncio
import re
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig

URL = "https://mgmits.ac.in/placement/"

async def main():
    browser_config = BrowserConfig(headless=True)
    run_config = CrawlerRunConfig()

    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(
            url=URL,
            config=run_config
        )
    
        markdown = result.markdown or ""
        


        for match in re.finditer("ninja", markdown, re.IGNORECASE):
            start = max(0, match.start() - 500)
            end = min(len(markdown), match.end() + 800)

            print("\n--- NINJA MATCH ---\n")
            print(markdown[start:end])


        print("Page title:", result.metadata.get("title"))
        print("Final URL:", getattr(result, "url", URL))
        print("Content length:", len(markdown))

        for term in ["TCS", "Ninja", "placement", "2022-2026"]:
            print(f"{term}: {markdown.lower().count(term.lower())} occurrences")

        with open("placement_extracted.md", "w", encoding="utf-8") as f:
            f.write(markdown)

        print("\nSaved full content to placement_extracted.md")
        print("\nLast 2000 characters:\n", markdown[-2000:])




if __name__ == "__main__":
    asyncio.run(main())
