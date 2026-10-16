-- Elimeni AI shared template catalog. Apply to the existing Supabase database.
-- Everyone can READ active free templates; only the server service role can write.
create table if not exists public.website_templates (
 slug text primary key,
 name text not null,
 category text not null,
 emoji text not null default '🌐',
 description text not null,
 prompt text not null,
 design_config jsonb not null default '{}'::jsonb,
 is_free boolean not null default true,
 is_active boolean not null default true,
 sort_order integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_website_templates_catalog on public.website_templates (is_active, sort_order);
alter table public.website_templates enable row level security;
drop policy if exists "public read active templates" on public.website_templates;
create policy "public read active templates" on public.website_templates for select using (is_active = true);
-- No client write policies. Server-side service role controls the catalog.
insert into public.website_templates (slug, name, category, emoji, description, prompt, design_config, is_free, sort_order) values
  ('agency-homepage', 'Agency homepage', 'business', '🏢', 'Hero, services, team, contact', 'Build an agency homepage with hero, services grid, team section and contact form', '{"builder": "elementor"}'::jsonb, true, 1),
  ('luxury-restaurant', 'Luxury restaurant', 'restaurant', '🍽️', 'Elegant dark design with menu', 'Build an elegant luxury restaurant homepage with dark background, gold accents, menu section and reservation form', '{"builder": "elementor"}'::jsonb, true, 2),
  ('catering-business', 'Catering business', 'business', '🎂', 'Events, gallery, booking form', 'Build an elegant catering business homepage with services for weddings and corporate events, gallery, and booking form', '{"builder": "elementor"}'::jsonb, true, 3),
  ('creative-portfolio', 'Creative portfolio', 'portfolio', '🎨', 'Full-screen works grid', 'Build a creative portfolio homepage with full-screen hero, project grid and about section', '{"builder": "elementor"}'::jsonb, true, 4),
  ('online-store', 'Online store', 'ecommerce', '🛍️', 'Products, featured items, newsletter', 'Build an online store homepage with product grid, featured items section and newsletter signup', '{"builder": "elementor"}'::jsonb, true, 5),
  ('gym-fitness', 'Gym & fitness', 'business', '🏋️', 'Classes, trainers, membership', 'Build a gym and fitness homepage with classes schedule, trainer profiles and membership pricing', '{"builder": "elementor"}'::jsonb, true, 6),
  ('caf-coffee-shop', 'Café & coffee shop', 'restaurant', '☕', 'Menu, atmosphere, locations', 'Build a cozy cafe homepage with menu, atmosphere section and locations', '{"builder": "elementor"}'::jsonb, true, 7),
  ('photographer', 'Photographer', 'portfolio', '📸', 'Gallery, packages, booking', 'Build a photographer portfolio with full-screen gallery, pricing packages and booking form', '{"builder": "elementor"}'::jsonb, true, 8),
  ('personal-blog', 'Personal blog', 'blog', '✍️', 'Posts, categories, author bio', 'Build a personal blog homepage with featured posts, category filters and author bio section', '{"builder": "elementor"}'::jsonb, true, 9),
  ('medical-clinic', 'Medical clinic', 'business', '🏥', 'Services, doctors, appointments', 'Build a medical clinic homepage with services, doctor profiles and appointment booking form', '{"builder": "elementor"}'::jsonb, true, 10),
  ('jewelry-store', 'Jewelry store', 'ecommerce', '💍', 'Elegant product showcase', 'Build an elegant jewelry store homepage with product showcase, collections grid and brand story', '{"builder": "elementor"}'::jsonb, true, 11),
  ('real-estate-agency', 'Real estate agency', 'business', '🏠', 'Listings, search, agents', 'Build a real estate agency homepage with property listings, search and agent profiles', '{"builder": "elementor"}'::jsonb, true, 12),
  ('law-firm', 'Law firm', 'portfolio', '⚖️', 'Practice areas, attorneys, contact', 'Build a professional law firm homepage with practice areas, attorney profiles and contact form', '{"builder": "elementor"}'::jsonb, true, 13),
  ('pizza-restaurant', 'Pizza restaurant', 'restaurant', '🍕', 'Menu, order online, locations', 'Build a pizza restaurant homepage with menu, online ordering section and locations', '{"builder": "elementor"}'::jsonb, true, 14),
  ('tech-blog', 'Tech blog', 'blog', '💻', 'Articles, tutorials, newsletter', 'Build a tech blog homepage with latest articles, tutorial categories and newsletter signup', '{"builder": "elementor"}'::jsonb, true, 15),
  ('travel-agency', 'Travel agency', 'business', '✈️', 'Destinations, packages, booking', 'Build a travel agency homepage with featured destinations, travel packages and booking form', '{"builder": "elementor"}'::jsonb, true, 16),
  ('ai-startup', 'AI Startup', 'saas', '✨', 'Modern AI landing page with glow and bento grids', 'Build a premium AI startup landing page with a refined modern design, gradient glow accents, product demonstration, bento feature grid, testimonials, and clear calls to action. Use responsive layouts and subtle accessible motion.', '{"style": "modern-responsive", "builder": "elementor", "motion": "subtle-accessible"}'::jsonb, true, 17),
  ('saas-platform', 'SaaS Platform', 'saas', '📊', 'Clean product marketing and conversion sections', 'Build a modern SaaS landing page with an elegant product hero, dashboard preview, feature comparisons, bento cards, testimonials and pricing. Use precise spacing, contemporary typography and responsive, subtle animations.', '{"style": "modern-responsive", "builder": "elementor", "motion": "subtle-accessible"}'::jsonb, true, 18),
  ('software-launch', 'Software Launch', 'saas', '🚀', 'Bold startup product launch layout', 'Build a striking software product launch website with compelling hero, feature highlights, product screens, integrations and pricing. Use clean gradients and tasteful micro-interactions.', '{"style": "modern-responsive", "builder": "elementor", "motion": "subtle-accessible"}'::jsonb, true, 19),
  ('design-studio', 'Design Studio', 'portfolio', '🧩', 'Editorial layouts and motion-led case studies', 'Build a modern design studio homepage with bold editorial typography, asymmetric project showcase, case studies and smooth accessible reveal effects.', '{"style": "modern-responsive", "builder": "elementor", "motion": "subtle-accessible"}'::jsonb, true, 20),
  ('motion-agency', 'Motion Agency', 'portfolio', '🎬', 'Immersive portfolio for a creative team', 'Build a contemporary creative motion agency homepage with immersive project showcases, strong typography, featured reels placeholders, interactive hover states and contact CTA.', '{"style": "modern-responsive", "builder": "elementor", "motion": "subtle-accessible"}'::jsonb, true, 21),
  ('branding-agency', 'Branding Agency', 'portfolio', '🪄', 'Premium visual storytelling and services', 'Build a stylish branding agency homepage with bold brand storytelling, project case studies, services, proof points and an engaging contact section.', '{"style": "modern-responsive", "builder": "elementor", "motion": "subtle-accessible"}'::jsonb, true, 22),
  ('fashion-boutique', 'Fashion Boutique', 'ecommerce', '🧥', 'Minimal product collections and lookbook', 'Build a premium modern fashion boutique homepage with a lookbook hero, featured collections, product highlights, brand narrative and newsletter, responsive and WooCommerce-friendly.', '{"style": "modern-responsive", "builder": "elementor", "motion": "subtle-accessible"}'::jsonb, true, 23),
  ('home-decor-store', 'Home Decor Store', 'ecommerce', '🪑', 'Editorial product galleries and collections', 'Build a sophisticated home decor ecommerce homepage with editorial photography placeholders, category tiles, featured products, USP icons and newsletter.', '{"style": "modern-responsive", "builder": "elementor", "motion": "subtle-accessible"}'::jsonb, true, 24),
  ('skincare-store', 'Skincare Store', 'ecommerce', '🌿', 'Soft premium beauty ecommerce aesthetic', 'Build a modern skincare store landing page with warm minimal branding, product benefits, ingredient storytelling, product cards, customer reviews and conversion CTAs.', '{"style": "modern-responsive", "builder": "elementor", "motion": "subtle-accessible"}'::jsonb, true, 25),
  ('real-estate-modern', 'Real Estate Modern', 'business', '🏡', 'Property cards and premium location content', 'Build a premium real estate agency website with large imagery, property listing previews, neighborhood highlights, agent profiles and strong inquiry calls to action.', '{"style": "modern-responsive", "builder": "elementor", "motion": "subtle-accessible"}'::jsonb, true, 26),
  ('modern-bistro', 'Modern Bistro', 'restaurant', '🍜', 'High-end food photography and menu', 'Build a contemporary bistro landing page with full-width food photography placeholders, seasonal menu, chef story, reviews and reservation CTA. Choose colors based on the restaurant brand.', '{"style": "modern-responsive", "builder": "elementor", "motion": "subtle-accessible"}'::jsonb, true, 27),
  ('it-consultancy', 'IT Consultancy', 'business', '💡', 'Trust-focused services and case studies', 'Build a polished IT consulting website with clean hero, service offerings, process timeline, success metrics, case studies and contact CTA.', '{"style": "modern-responsive", "builder": "elementor", "motion": "subtle-accessible"}'::jsonb, true, 28)
on conflict (slug) do update set name=excluded.name, category=excluded.category, emoji=excluded.emoji, description=excluded.description, prompt=excluded.prompt, design_config=excluded.design_config, is_free=excluded.is_free, sort_order=excluded.sort_order, updated_at=now();
