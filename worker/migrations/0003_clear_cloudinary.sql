-- Cloudinary is decommissioned (account disabled). Clear any leftover
-- Cloudinary image URLs and public IDs so they are neither served nor shown.
UPDATE jokes
   SET image_url       = NULL,
       image_public_id = NULL
 WHERE image_url LIKE '%res.cloudinary.com%';