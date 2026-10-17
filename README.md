# Blackjack Count Trainer

A free blackjack app for practising **Hi-Lo card counting** and **basic strategy** on your phone. It installs on your home screen like a normal app, works offline, and costs nothing to host. It's for practice only and uses no real money.

## What it does

- **Full blackjack game** with hit, stand, double, split (up to 4 hands) and late surrender. You choose 1–8 decks, whether the dealer hits or stands on soft 17, and how much of the shoe is dealt before a reshuffle. Blackjack pays 3:2, and you can take insurance or even money.
- **Hi-Lo counting.** The bar at the top shows the running count (RC), the true count (TC = RC ÷ decks left) and the decks remaining. Tap it to hide or show the count. With quizzes on, the app sometimes asks "What's the running count?" after a hand and tells you whether you were right.
- **Count drill.** Cards flash one at a time at a speed you choose. At the end you enter the count, then see every card with the running total under it.
- **Basic strategy trainer.** Each time you make a wrong move, the app tells you the correct play.
- **Illustrious 18.** Turn this on and the trainer also grades the 18 most valuable count-based plays (for example, stand on 16 vs 10 when the TC is 0 or higher).
- **Bet spread advice.** The app suggests a bet based on the true count. Tap **Use tip** to bet that amount.
- **Stats.** Shows count accuracy, strategy accuracy, drill results, hands played, a bankroll chart and your recent mistakes.
- **Strategy chart.** Tap the grid icon to see a chart that matches your current table rules.
- Sound, vibration (Android only, because iPhones don't let websites vibrate), smooth deal animations, and a green felt look. All cards are drawn in code, so the app needs no image files.

Your settings, stats and bankroll are saved on your phone and stay there after you close the app.

---

## Put it online with GitHub Pages (free, step by step)

You need a free GitHub account. If you don't have one, sign up at <https://github.com/signup>.

### 1. Create the repository

1. Go to <https://github.com> and sign in.
2. Click the **+** in the top-right corner, then **New repository**.
3. In **Repository name**, type a short name with no spaces, for example `count-trainer`.
4. Choose **Public**. Free GitHub Pages needs a public repository.
5. Leave the other options alone and click **Create repository**.

### 2. Upload the files

1. On the new repository page, click the link **uploading an existing file**. If you don't see it, click **Add file → Upload files**.
2. Open the folder with these files on your computer. Select **everything inside it**: `index.html`, `manifest.json`, `sw.js`, `README.md` and the folders `css`, `js`, `icons` and `tests`.
3. Drag all of it into the upload box in your browser.
   - Drag the folders themselves, not just the files inside them, so the folder structure is kept.
   - If your browser won't accept folders, upload the loose files first. Then, for each folder, click **Add file → Upload files** again and type the folder name in front of the file name (for example `js/`) before you drop the files.
4. Scroll down and click **Commit changes**.

When you're done, the repository's main page should look like this:

```
css/
icons/
js/
tests/
index.html
manifest.json
README.md
sw.js
```

`index.html` must be at the top level, not inside another folder.

### 3. Turn on GitHub Pages

1. In your repository, click **Settings** (the tab with the gear icon).
2. In the left menu, click **Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Under **Branch**, choose **main** and **/ (root)**, then click **Save**.
5. Wait one or two minutes, then refresh the page. A box appears that says **"Your site is live at …"**. Your address looks like:

   ```
   https://YOUR-USERNAME.github.io/count-trainer/
   ```

   If the box isn't there yet, wait another minute and refresh. You can watch the progress under the **Actions** tab.

### 4. Open it on your phone and add it to your home screen

Type your address into your phone's browser, then:

**iPhone (Safari)**
1. Open the address in **Safari**. Other browsers on iPhone may not offer this option.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**. The app icon appears on your home screen. Open the app from there and it runs full-screen, without the browser bars.

**Android (Chrome)**
1. Open the address in **Chrome**.
2. Tap the **⋮** menu in the top-right corner.
3. Tap **Install app** (on some phones it's called **Add to Home screen**), then tap **Install**.

Open the app once while you're online. After that it also works offline.

---

## How to use it

1. **Bet:** tap the chips. Tap the dashed circle or **Clear** to start over. Then tap **Deal**.
2. **Play:** tap Hit, Stand, Double, Split or Surrender. Buttons you can't use right now are greyed out.
3. If you make a wrong move, a box at the top shows the correct play.
4. The icons at the top right open the **Count drill**, the **Strategy chart**, **Stats** and **Settings**.

**Hi-Lo in one line:** 2–6 count **+1**, 7–9 count **0**, and 10/J/Q/K/A count **−1**. The dealer's face-down card only counts once it's turned over. When the cut card comes out, the shoe is reshuffled and the count goes back to 0.

**House rules used:** the dealer checks for blackjack under an ace or a ten. You may double on any first two cards, and after a split if you leave that setting on. You can split up to 4 hands. Split aces get one card each and can't be split again. A 21 after a split pays 1:1, not 3:2. Late surrender can be turned on or off.

The strategy chart is the standard multi-deck chart, adjusted for your soft-17, surrender and double-after-split settings. The Illustrious 18 index numbers are the usual ones for multi-deck games where the dealer stands on soft 17.

---

## Updating the app later

If you change a file, upload the new version to the repository the same way (**Add file → Upload files**, then **Commit changes**). GitHub Pages republishes it within a minute or two. The app downloads the newest files whenever your phone is online, so you don't need to reinstall it. Closing and reopening the app is enough.

## Checking the game logic (optional)

The `tests` folder has automated checks for hand totals (soft and hard aces), 3:2 blackjack payouts, doubling, surrender, insurance, splitting rules, soft-17 rules, Hi-Lo count tracking and the strategy chart. It also plays 20,000 random hands to make sure the money and the count always add up. The app works without these checks. To run them yourself, install [Node.js](https://nodejs.org) and type this in a terminal, inside the folder:

```bash
node tests/run-tests.js
```

## Files

| File | What it is |
|---|---|
| `index.html` | The page itself |
| `css/styles.css` | All the styling (felt table, cards, buttons) |
| `js/engine.js` | Blackjack rules: shoe, hand totals, payouts, count |
| `js/strategy.js` | Basic strategy, Illustrious 18, bet advice |
| `js/app.js` | Screens, buttons, animations, sounds, stats |
| `manifest.json` | Lets phones install it as an app |
| `sw.js` | Service worker, which makes the app work offline |
| `icons/` | App icons |
| `tests/run-tests.js` | Optional logic tests |
