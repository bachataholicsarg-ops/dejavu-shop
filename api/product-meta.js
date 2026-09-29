function decode(s=""){return String(s).replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#039;|&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).trim()}
function strip(s=""){return decode(String(s).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," "))}
function first(html,patterns){for(const rx of patterns){const m=html.match(rx);if(m&&m[1])return decode(m[1])}return""}
function numberFrom(v=""){const s=String(v).replace(/[^0-9.,]/g,"").trim();if(!s)return null;let n;if(s.includes(",")&&s.includes(".")){n=s.lastIndexOf(",")>s.lastIndexOf(".")?Number(s.replace(/\./g,"").replace(",",".")):Number(s.replace(/,/g,""))}else if(s.includes(",")){const p=s.split(",");n=p[p.length-1].length<=2?Number(s.replace(/\./g,"").replace(",",".")):Number(s.replace(/,/g,""))}else n=Number(s);return Number.isFinite(n)?n:null}
export default async function handler(req,res){
 try{
  const raw=String(req.query.url||""); if(!raw)return res.status(400).json({error:"Missing url"});
  const pageUrl=new URL(raw); const allowed=["mayorlocalnancy.com","www.mayorlocalnancy.com"].includes(pageUrl.hostname);
  if(!allowed||pageUrl.protocol!=="https:")return res.status(403).json({error:"Not allowed"});
  const page=await fetch(pageUrl.toString(),{headers:{"user-agent":"Mozilla/5.0 (compatible; DejaVuShop/1.0)","accept-language":"es-AR,es;q=0.9,en;q=0.7"},redirect:"follow"});
  if(!page.ok)return res.status(502).json({error:"Supplier page unavailable",status:page.status});
  const html=await page.text();
  const title=first(html,[/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,/<h1[^>]*class=["'][^"']*product_title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,/<title>([\s\S]*?)<\/title>/i]);
  let description=first(html,[/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,/<div[^>]+class=["'][^"']*woocommerce-product-details__short-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i]);
  description=strip(description);
  let priceText=first(html,[/<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']product:price:amount["']/i,/<p[^>]+class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/p>/i]);
  if(priceText)priceText=strip(priceText);
  let price=numberFrom(priceText);
  if(price==null){
    for(const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
      try{const j=JSON.parse(m[1]);const stack=Array.isArray(j)?j:[j];for(const x of stack){const o=x?.offers||x?.["@graph"]?.find?.(y=>y?.offers)?.offers;if(o){const one=Array.isArray(o)?o[0]:o;const val=one?.price??one?.lowPrice;if(val!=null){price=numberFrom(val);if(price!=null)break}}}if(price!=null)break}catch{}
    }
  }
  return res.status(200).json({url:pageUrl.toString(),title:strip(title),description,price,price_text:priceText||null});
 }catch(e){return res.status(500).json({error:"Metadata proxy error"})}
}