import { publicUrls } from '../lib/publishing';
export async function GET() {
  return new Response(JSON.stringify([...new Set([...await publicUrls(), '/writing/search/', '/404/'])]), {headers:{'Content-Type':'application/json'}});
}
