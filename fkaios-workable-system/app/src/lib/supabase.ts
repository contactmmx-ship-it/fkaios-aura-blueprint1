import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nrlsqshkjuuwiovthrnb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ybHNxc2hranV1d2lvdnRocm5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4ODM2MjUsImV4cCI6MjA5NzQ1OTYyNX0.fSzGBIvUqhWLsaEzKBdX-y5l8mIxjSz9VQ_yXOMRh4g';

export const supabase = createClient(supabaseUrl, supabaseKey);