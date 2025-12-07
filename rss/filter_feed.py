import feedparser
import xml.etree.ElementTree as ET
import argparse
import xml.dom.minidom
import json
import os
import logging

# Define paths (adjust if necessary based on where these scripts are run from)
DATA_DIR = "/data"
USER_STATE_DIR = os.path.join(DATA_DIR, "user_state")
KEYWORD_BLACKLIST_JSON = os.path.join(USER_STATE_DIR, "keywordBlacklist.json")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def load_keyword_blacklist():
    if not os.path.exists(KEYWORD_BLACKLIST_JSON):
        logging.warning(f"Keyword blacklist JSON file not found: {KEYWORD_BLACKLIST_JSON}")
        return []
    try:
        with open(KEYWORD_BLACKLIST_JSON, 'r', encoding='utf-8') as f:
            data = json.load(f)
            keywords = data.get('value', [])
            # Ensure all keywords are strings and convert to lowercase for matching
            return [str(kw).lower() for kw in keywords if isinstance(kw, (str, int, float))]
    except json.JSONDecodeError as e:
        logging.error(f"Error decoding keyword blacklist JSON: {e}")
        return []
    except Exception as e:
        logging.error(f"Error loading keyword blacklist: {e}")
        return []

# Set up argument parser
parser = argparse.ArgumentParser(description="Filter an RSS feed based on keywords.")
parser.add_argument("--input", required=True, help="Path to the input RSS file")
parser.add_argument(
    "--output", required=True, help="Path to save the filtered RSS file"
)


# Parse arguments
args = parser.parse_args()

# Assign parsed arguments to variables
input_rss_file = args.input
output_rss_file = args.output


# Print the parsed arguments (optional, for testing purposes)
print(f"Input RSS file: {input_rss_file}")
print(f"Output RSS file: {output_rss_file}")






def save_pretty_xml(output_file, tree):
    """Save the XML tree to the file with pretty printing."""
    # Convert the tree to a string
    xml_str = ET.tostring(tree.getroot(), encoding="utf-8", method="xml")

    # Use minidom to format the string with indentation
    pretty_xml = xml.dom.minidom.parseString(xml_str).toprettyxml(indent="  ")

    # Write the pretty-printed XML to the file
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(pretty_xml)


def filter_rss_entries(input_file, output_file):
    """Filter RSS feed entries based on keywords."""
    # Load filter keywords
    keywords = load_keyword_blacklist()

    # Parse the RSS feed
    print(f"Parsing RSS feed from {input_file}...")
    feed = feedparser.parse(input_file)
    if not feed.entries:
        print(f"Warning: No entries found in the RSS feed.")
        exit(1)

    # Filter entries based on keywords
    filtered_entries = []
    for entry in feed.entries:
        # Combine all fields of the entry into a single text for keyword matching
        entry_text = " ".join(
            [str(value).lower() for key, value in entry.items() if value]
        )
        matched = next((kw for kw in keywords if kw in entry_text), None)

        if matched is None:
            filtered_entries.append(entry)
        else:
            print(
                f"Excluding entry with keyword match: "
                f"{matched}: {getattr(entry, 'title', 'No title')}"
            )
    print(f"Filtered {len(filtered_entries)} entries out of {len(feed.entries)}.")

    # Create a new XML tree for the filtered feed, declaring media namespace
    filtered_root = ET.Element(
        "rss", attrib={"version": "2.0", "xmlns:media": "http://search.yahoo.com/mrss/"}
    )
    channel_elem = ET.SubElement(filtered_root, "channel")

    # Add metadata from the original feed
    for key, value in feed.feed.items():
        ET.SubElement(channel_elem, key).text = str(value)

    # Add filtered entries to the feed
    for entry in filtered_entries:
        item = ET.SubElement(channel_elem, "item")  # define 'item' here
        ET.SubElement(item, "title").text = entry.get("title", "")
        for linkinfo in entry.links:
            ET.SubElement(
                item,
                "link",
                attrib={
                    "href": linkinfo["href"],
                    "rel": linkinfo.get("rel", ""),
                    "type": linkinfo.get("type", ""),
                },
            )
        # ==== BUILD RAW HTML FOR DESCRIPTION (prefer full content over summary) ====
        raw_html = ""
        if entry.get("content"):
            # Use the full content block if available
            raw_html = entry.content[0].value
        elif entry.get("summary"):
            # Fallback to summary
            raw_html = entry.summary
        elif entry.get("description"):
            # Some feeds use description directly
            raw_html = entry.description
        ET.SubElement(item, "description").text = raw_html
        # ========================================================================

        ET.SubElement(item, "pubDate").text = entry.get("published", "")
        ET.SubElement(item, "guid").text = entry.get("id", entry.link)

        if "author" in entry:
            ET.SubElement(item, "author").text = entry["author"]

        for tag in entry.get("tags", []):
            ET.SubElement(item, "category").text = tag.get("term", "")

    # Create the XML tree for the filtered feed
    filtered_tree = ET.ElementTree(filtered_root)

    # Save the filtered feed to a new RSS file using the pretty print function
    try:
        save_pretty_xml(output_file, filtered_tree)
        print(f"Filtered RSS feed saved to {output_file}.")
    except Exception as e:
        print(f"Error saving filtered feed: {e}")
        exit(1)


# Run the filtering process
filter_rss_entries(input_rss_file, output_rss_file)