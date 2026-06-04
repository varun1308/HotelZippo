-- 0005_storage.sql
-- hotel-images Storage bucket (public-read) for hero images — see 12g / specs/01b-image-sourcing.md.
-- v1: Publish-to-Hotels downloads the TripAdvisor hero, uploads here, and writes the
-- Storage URL to hotels.images[0]. Writes are server-side (service role) only.

insert into storage.buckets (id, name, public)
values ('hotel-images', 'hotel-images', true)
on conflict (id) do nothing;

-- Public read of objects in the hotel-images bucket.
create policy "hotel-images public read"
  on storage.objects for select
  using (bucket_id = 'hotel-images');

-- No insert/update/delete policy → only the service role (server-side publish) can write.
