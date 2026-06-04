/* Loads local Supabase test credentials (.env.test) for the node integration project.
 * .env.test holds the PUBLIC well-known local Supabase defaults (not secrets). */
import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.join(process.cwd(), '.env.test') });
