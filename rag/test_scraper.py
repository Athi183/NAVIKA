import requests
from bs4 import BeautifulSoup

url = "https://mgmits.ac.in/"

response = requests.get(url, timeout=10)

print("Status:", response.status_code)

soup = BeautifulSoup(response.text, "html.parser")

# Remove unwanted sections
for tag in soup(["script", "style", "header", "footer", "nav"]):
    tag.decompose()

# Get remaining text
import requests
from bs4 import BeautifulSoup

url = "https://mgmits.ac.in/"

response = requests.get(url, timeout=10)

print("Status:", response.status_code)

soup = BeautifulSoup(response.text, "html.parser")

# Remove unwanted webpage elements
for tag in soup(["script", "style", "header", "footer", "nav"]):
    tag.decompose()

# Extract content boxes
for box in soup.select(".bxCnt"):

    title_tag = box.select_one(".tle")

    if not title_tag:
        continue

    title = title_tag.get_text(" ", strip=True)

    # Find a link inside this box
    link_tag = box.find("a", href=True)

    if link_tag:
        link = link_tag["href"]
    else:
        link = None

    # Remove title before extracting content
    title_tag.decompose()

    content = box.get_text(" ", strip=True)

    if not content:
        continue

    print("\n----------------------------")
    print("TITLE:", title)
    print("CONTENT:", content)
    print("LINK:", link)
    # Ignore empty sections
    if not content:
        continue

    print("\n----------------------------")
    print("TITLE:", title)
    print("CONTENT:", content)
        # Find the text "ABOUT US"
about = soup.find(string=lambda text: text and "ABOUT US" in text)

if about:
    print(about.parent.prettify()[:5000])