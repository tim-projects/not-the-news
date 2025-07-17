# not-the-news

![image](screenshot.jpg)

Not The News is a 'Deck based rss feed system.' which is designed to prevent doom scrolling.

The premise of Not The News is simple: Stop wasting time.

Wasting time on casual browsing, wasting time on algorithms and video reels that you can't control. Wasting time on ads.

The fact is that social media is not good for your health, your productivity, or your overall life.

Not The News aims to be a solution to this. It's the itch for myself I had to scratch. (Maybe you need it too).

At it's core a browser based single page scroll rss reader with keyword filtering. Multiple rss feeds are regularly aggregated into a single scrollable feed, rss items that flag up with filtered keywords are removed.

But the idea is to keep things minimal, and to _focus_ you. So that you can get on with life, preferably away from the internet.

So, you can only see 10 items at a time.
Want to see more than 10 items?

No problem - but you have to consume the 10 items you have first!

When you read an item and then close it. It stays closed and hidden. And you never see it again (unless you look for it under the hidden drop down, or star it to save it permanently).

When you close all 10 items in the list, 10 more show up.

To make this a little less rigid - You have the option to shuffle the deck.
The shuffle button in the top right of the app will give you a new random set of rss feed items. But be warned - you only get 2 shuffles per day.

It's not all bad though, since every time you clear the current deck you earn a free shuffle! In this way, the app helps you to find a balance between mindless scrolling and useful reading.

The app has no folders, and manages everything automagically without your input.

You just read and go. No distractions. No confusion. No ulterior motives.

You add the rss feeds that you want, and then use the app.

If the feed is overwhelming with items you don't want to read, then add more filtering keywords, or tweak the feeds you use.

It's about balance. And simplicity. While still feeling personal.

Your own personal algorithm. For you.

If you want the latest news updates using this app, you can. But I encourage you to think differently about how you consume information. Not The News is the tool to help with that.

Current Features:

- Keyword filtering - only see the information you want to see.
- Night/Day mode
- Auto reload in the background when new rss items are available
- Works offline when no connection
- Automatic cross browser/device syncing with low data usage
- Feed filter modes (Unread/Starred/Hidden/All)
- Starred items are saved items
- Shuffle mode

## Requirements

Not The News currently requires:

- A vps/server that can run docker
- A web domain (yourdomain.com) that points to the server that runs docker

## Configuration

Clone the repo:
```git clone https://github.com/tim-projects/not-the-news.git```

For the first run. Edit and rename the config examples in
www/config/

- feeds.txt
- filter_keywords.txt

Once the app is running you can use the settings cog icon in the top right, to configure everything.

## Running it

### Build and run the container

Build it with a domain name, your email (for letsencrypt), and the password so that you can login
```./build.sh -d <yourdomain.com> -e <admin@youremail.com> -n -p <yourpassword>```

Then when you open the site the password is the one set as above.

## Optional - set up a cron to backup the data every 12 hours

By default all the data is stored inside a docker container volume. This cron command will backup every 12 hours to a local folder, so that you can save your app usage (in case your server fails).

```sudo echo "0 */12 * * * cd <FOLDER WHERE NOT-THE-NEWS IS LOCATED> && sh backup.sh" >> /var/spool/cron/crontabs/root```
