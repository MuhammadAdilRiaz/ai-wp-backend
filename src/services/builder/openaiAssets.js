const OpenAI = require('openai');
const supabase = require('../../lib/supabase');
let client;
function openai() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for website content and asset preparation.');
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}
function cleanJSON(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,'').trim();
  return JSON.parse(text);
}
async function prepareCreativeBrief({ request, wpContext, images = [] }) {
  const site = { name:wpContext?.site_title, theme:wpContext?.theme, builder:wpContext?.builder };
  const userContent = [
    { type:'text', text: `User request:\n${String(request).slice(0,6000)}\nWordPress information:\n${JSON.stringify(site)}\nProduce ORIGINAL professional copy, brand direction, visual-asset requirements, and icon names. Do NOT generate website code or WordPress actions.` },
    ...images.map(img => ({type:'image_url', image_url:{url:img.url,detail:'high'}}))
  ];
  const result = await openai().chat.completions.create({
    model:process.env.ELIMENI_OPENAI_CONTENT_MODEL || 'gpt-4.1-mini',
    max_completion_tokens:2200,
    response_format:{type:'json_object'},
    messages:[
      {role:'system',content:'You are Elimeni AI creative director and copywriter. Output strict JSON with keys brand (palette,typography,tone), pages (array of title, sections with heading, body, cta), visuals (array of placement, prompt, alt), icons (array of section, lucide_name), and notes. Never assert fabricated business facts, ratings, testimonials, certifications, or contact details. User-provided logo/ref imagery is authoritative. Do not create code, HTML, SVG executable markup, or WordPress actions.'},
      {role:'user',content:userContent},
    ],
  });
  return { brief:cleanJSON(result.choices?.[0]?.message?.content), usage:{input_tokens:result.usage?.prompt_tokens||0,output_tokens:result.usage?.completion_tokens||0}, model:result.model };
}
// Optional real asset creation. Image files are published only when the site owner
// configured a dedicated public Supabase Storage bucket for generated visuals.
async function createHeroAsset(brief) {
  if (process.env.ELIMENI_GENERATE_HERO_IMAGE !== 'true') return {status:'disabled'};
  const bucket = process.env.ELIMENI_MEDIA_BUCKET;
  if (!bucket) return {status:'not_configured', reason:'Set ELIMENI_MEDIA_BUCKET to a dedicated public Supabase Storage bucket.'};
  const chosen = Array.isArray(brief?.visuals) && brief.visuals.find(x => typeof x?.prompt === 'string' && x.prompt.length > 10);
  if (!chosen) return {status:'no_visual_brief'};
  const img = await openai().images.generate({
    model:process.env.ELIMENI_OPENAI_IMAGE_MODEL || 'gpt-image-2.5-flare',
    prompt:`High quality realistic editorial website hero image, no text, no logos, no watermarks: ${chosen.prompt.slice(0,1600)}`,
    size:'1536x1024',n:1,output_format:'webp'
  });
  const encoded=img.data?.[0]?.b64_json;
  if (!encoded) throw new Error('Image generation did not return image bytes.');
  const file=`generated/${require('crypto').randomUUID()}.webp`;
  const {error}=await supabase.storage.from(bucket).upload(file,Buffer.from(encoded,'base64'),{contentType:'image/webp',upsert:false});
  if (error) throw new Error(`Generated image storage failed: ${error.message}`);
  const {data}=supabase.storage.from(bucket).getPublicUrl(file);
  if (!data?.publicUrl) throw new Error('Generated image public URL unavailable.');
  return {status:'ready',url:data.publicUrl,placement:chosen.placement||'hero',alt:chosen.alt||'Website hero visual'};
}
module.exports={prepareCreativeBrief,createHeroAsset};
