export default async function handler(req, res) {
  try {
    const raw = String(req.query.url || "");
    if (!raw) return res.status(400).send("Missing url");

    const pageUrl = new URL(raw);
    const allowed =
      pageUrl.hostname === "mayorlocalnancy.com" ||
      pageUrl.hostname === "www.mayorlocalnancy.com";
    if (!allowed || pageUrl.protocol !== "https:") {
      return res.status(403).send("Not allowed");
    }

    const page = await fetch(pageUrl.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; DejaVuShop/1.0)",
        "accept-language": "es-AR,es;q=0.9,en;q=0.7"
      },
      redirect: "follow"
    });

    if (!page.ok) return res.status(502).send("Supplier page unavailable");
    const html = await page.text();

    const patterns = [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
      /<img[^>]+class=["'][^"']*wp-post-image[^"']*["'][^>]+src=["']([^"']+)["']/i,
      /<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*wp-post-image[^"']*["']/i,
      /woocommerce-product-gallery__image[\s\S]{0,1000}?data-src=["']([^"']+)["']/i,
      /woocommerce-product-gallery__image[\s\S]{0,1000}?src=["']([^"']+)["']/i
    ];

    let imageUrl = "";
    for (const rx of patterns) {
      const m = html.match(rx);
      if (m && m[1]) {
        imageUrl = m[1].replace(/&amp;/g, "&");
        break;
      }
    }

    if (!imageUrl) return res.status(404).send("Image not found");

    const absolute = new URL(imageUrl, pageUrl).toString();
    const img = await fetch(absolute, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; DejaVuShop/1.0)" },
      redirect: "follow"
    });

    if (!img.ok) return res.status(502).send("Image unavailable");

    const type = img.headers.get("content-type") || "image/jpeg";
    const data = Buffer.from(await img.arrayBuffer());

    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).send(data);
  } catch (e) {
    return res.status(500).send("Image proxy error");
  }
}