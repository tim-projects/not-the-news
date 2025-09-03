import json
import os
from datetime import datetime, timezone

CATEGORY_MAPPING = {
    "devops jobs": "Technology",
    "news": "News",
    "reddit all feed": "Social Media",
    "facebook pages": "Social Media",
    "vietnam news": "News",
    "youtube": "Social Media",
    "finance": "Finance",
    "health": "Health",
    "spirituality": "Spirituality", # Changed from Lifestyle to Spirituality
    "technology": "Technology",
    "business": "Business",
    "misc": "Miscellaneous",
    "lifestyle": "Lifestyle",
    # Add more mappings as needed based on feeds.txt content
}

def get_standard_category(raw_category):
    """Maps a raw category string to a standardized category."""
    return CATEGORY_MAPPING.get(raw_category.lower(), "Miscellaneous")

def convert_feeds_txt_to_json(input_file, output_file):
    """
    Converts feeds.txt to rssFeeds.json with category and subcategory information.
    Extracts category and subcategory from comments in the .txt file.
    """
    feeds_data = {} # Top-level dictionary for categories
    current_category_raw = "Uncategorized"
    current_subcategory_raw = "Default"

    # Ensure initial category and subcategory exist
    current_category_standard = get_standard_category(current_category_raw)
    feeds_data[current_category_standard] = {}
    feeds_data[current_category_standard][current_subcategory_raw] = []

    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line: # Skip empty lines
                    continue
                
                if line.startswith('##'):
                    # This is a subcategory
                    potential_subcategory = line[2:].strip()
                    if potential_subcategory:
                        current_subcategory_raw = potential_subcategory
                        # Ensure category exists before adding subcategory
                        if current_category_standard not in feeds_data:
                            feeds_data[current_category_standard] = {}
                        if current_subcategory_raw not in feeds_data[current_category_standard]:
                            feeds_data[current_category_standard][current_subcategory_raw] = []
                elif line.startswith('#'):
                    # This is a category
                    potential_category = line[1:].strip()
                    if potential_category:
                        current_category_raw = potential_category
                        current_category_standard = get_standard_category(current_category_raw)
                        current_subcategory_raw = "Default" # Reset subcategory for new category
                        if current_category_standard not in feeds_data:
                            feeds_data[current_category_standard] = {}
                        if current_subcategory_raw not in feeds_data[current_category_standard]:
                            feeds_data[current_category_standard][current_subcategory_raw] = []
                else:
                    # This is a URL
                    url = line
                    # Ensure category and subcategory exist before appending URL
                    if current_category_standard not in feeds_data:
                        feeds_data[current_category_standard] = {}
                    if current_subcategory_raw not in feeds_data[current_category_standard]:
                        feeds_data[current_category_standard][current_subcategory_raw] = []
                    feeds_data[current_category_standard][current_subcategory_raw].append({"url": url})

        now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        output_content = {
            "value": feeds_data,
            "lastModified": now
        }

        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output_content, f, indent=2)
        print(f"Successfully converted '{input_file}' to '{output_file}'.")
    except FileNotFoundError:
        print(f"Error: Input file '{input_file}' not found.")
    except Exception as e:
        print(f"An error occurred during conversion: {e}")

def convert_keywords_txt_to_json(input_file, output_file):
    """
    Converts filter_keywords.txt to keywordBlacklist.json.
    """
    keywords_data = []
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    keywords_data.append(line)

        now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        output_content = {
            "value": keywords_data,
            "lastModified": now
        }

        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output_content, f, indent=2)
        print(f"Successfully converted '{input_file}' to '{output_file}'.")
    except FileNotFoundError:
        print(f"Error: Input file '{input_file}' not found.")
    except Exception as e:
        print(f"An error occurred during conversion: {e}")

if __name__ == "__main__":
    print("--- RSS Feeds Conversion ---")
    feeds_input = "feeds.txt"
    feeds_output = "rssFeeds.json"
    if os.path.exists(feeds_input):
        convert_feeds_txt_to_json(feeds_input, feeds_output)
    else:
        print(f"Skipping RSS feeds conversion: {feeds_input} not found.")

    print("\n--- Keyword Blacklist Conversion ---")
    keywords_input = "filter_keywords.txt"
    keywords_output = "keywordBlacklist.json"
    if os.path.exists(keywords_input):
        convert_keywords_txt_to_json(keywords_input, keywords_output)
    else:
        print(f"Skipping keyword blacklist conversion: {keywords_input} not found.")

    print("\nConversion process complete. Please place the generated .json files into your persistent Docker volume's /data/user_state/ directory.")
    print("For example, if your volume is named 'not-the-news_volume', you might copy them to: /var/lib/docker/volumes/not-the-news_volume/_data/user_state/")
    print("Remember to restart your Docker container after placing the files.")