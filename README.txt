KHALED'S GAUGEWISE - how to put it online
====================================

This folder is the whole website. It has no server code and no database:
everything runs in the visitor's browser, and their data never leaves it.

Files
  LICENSES.txt                  licence notices for the libraries (keep this file)
  index.html                    the app
  vendor/jspdf.umd.min.js       PDF builder (MIT licence)
  vendor/svg2pdf.umd.min.js     sharp graphs inside the PDF (MIT licence)

EASIEST: Netlify Drop (free, about 1 minute)
  1. Go to https://app.netlify.com/drop
  2. Drag this whole folder onto the page.
  3. You get a live link right away. Create a free account to keep it
     and rename it (for example khaleds-gaugewise.netlify.app).

GitHub Pages (free)
  1. Create a new public repository on github.com.
  2. Upload index.html and the vendor folder (keep the folder name).
  3. Settings > Pages > Source: "Deploy from a branch", branch "main", folder "/ (root)".
  4. Your site appears at https://YOUR-NAME.github.io/REPOSITORY-NAME/

Cloudflare Pages works the same way (Workers & Pages > Create > Upload assets).

Custom domain: all three let you connect your own domain (like gaugestudio.ca)
in their settings once the site is live.

Updating: replace index.html with the new version and upload again.
