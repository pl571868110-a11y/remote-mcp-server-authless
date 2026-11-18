import{timingSafeEqual}from"node:crypto";
export function authorized(value,secret){const a=Buffer.from(value||""),b=Buffer.from("Bearer "+secret);return a.length===b.length&&timingSafeEqual(a,b);}
export function verified(g,m,since,until){return g?.status==="VERIFIED"&&g.complete===true&&g.customer_id==="8073944491"&&g.currency==="UAH"&&g.since===since&&g.until===until&&m?.since===since&&m.until===until&&m.results?.length===2&&[["UA","act_1792664644903675","UAH"],["PL","act_1310408940864798","PLN"]].every(([c,id,currency])=>m.results.some(x=>x.country===c&&x.id===id&&x.currency===currency&&x.status==="VERIFIED"&&x.complete===true));}

