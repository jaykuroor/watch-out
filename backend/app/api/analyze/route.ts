import { NextRequest, NextResponse } from 'next/server';
import { fetchVideoData } from '@/app/lib/youtube';
import { searchWeb } from '@/app/lib/search';
import { extractClaims, verifyClaims, VerifiedClaim } from '@/app/lib/llm';
import { computeOverallScore } from '@/app/lib/scoring';

// In-memory cache (good enough for hackathon — resets on server restart)
const cache = new Map<string, AnalysisResponse>();

// Response type definitions
interface AnalysisResponse {
  videoId: string;
  status: 'success' | 'no_transcript' | 'error';
  metadata: { title: string; channel: string };
  overallScore: number | null;
  claims: VerifiedClaim[];
  transcript_preview: string | null;
  cached: boolean;
}

// Demo mode: pre-computed results for reliable demo Shorts
// These ensure the demo works even if YouTube/Tavily/LLM have issues
const DEMO_RESULTS: Record<string, AnalysisResponse> = {
  // Demo 1: Health misinformation (mostly refuted claims)
  'demo_health_myths': {
    videoId: 'demo_health_myths',
    status: 'success',
    metadata: { title: '5 Foods That Are Secretly Destroying Your Health', channel: 'HealthTruth' },
    overallScore: 0.25,
    claims: [
      {
        id: 1,
        text: 'Microwave ovens destroy 90% of nutrients in food',
        verdict: 'refuted',
        confidence: 'high',
        explanation: 'Multiple studies show microwaving retains similar or more nutrients than other cooking methods due to shorter cooking times and less water usage.',
        sources: [
          { title: 'Harvard Health Publishing', url: 'https://www.health.harvard.edu/staying-healthy/microwave-cooking-and-nutrition', snippet: 'Microwave cooking does not reduce the nutritional value of foods any more than conventional cooking...' }
        ]
      },
      {
        id: 2,
        text: 'Processed meat was classified by WHO as a Group 1 carcinogen in 2015',
        verdict: 'supported',
        confidence: 'high',
        explanation: 'The IARC (part of WHO) did classify processed meat as Group 1 carcinogenic in October 2015.',
        sources: [
          { title: 'WHO - IARC Monographs', url: 'https://www.who.int/news-room/questions-and-answers/item/cancer-carcinogenicity-of-the-consumption-of-red-meat-and-processed-meat', snippet: 'Processed meat was classified as carcinogenic to humans (Group 1)...' }
        ]
      },
      {
        id: 3,
        text: 'Eating bananas at night causes weight gain',
        verdict: 'refuted',
        confidence: 'med',
        explanation: 'No strong scientific evidence supports this. Weight gain depends on total caloric intake, not the timing of specific foods.',
        sources: [
          { title: 'Healthline', url: 'https://www.healthline.com/nutrition/eating-at-night', snippet: 'Research shows that weight gain is determined by total calorie intake, not when you eat...' }
        ],
        what_to_check_next: 'Look for clinical studies on meal timing and weight'
      }
    ],
    transcript_preview: 'Hey guys, today I want to talk about five foods that are secretly destroying your health...',
    cached: true
  },

  // Demo 2: Science myths (all refuted)
  'demo_science_myths': {
    videoId: 'demo_science_myths',
    status: 'success',
    metadata: { title: 'Mind-Blowing Science Facts You Didn\'t Know', channel: 'ScienceDaily' },
    overallScore: 0.0,
    claims: [
      {
        id: 1,
        text: 'Humans only use 10% of their brain',
        verdict: 'refuted',
        confidence: 'high',
        explanation: 'This is a popular myth. Brain imaging studies show that virtually all brain regions are active, even during simple tasks.',
        sources: [
          { title: 'Scientific American', url: 'https://www.scientificamerican.com/article/do-people-only-use-10-percent-of-their-brains/', snippet: 'The 10 percent myth has been debunked many times over...' }
        ]
      },
      {
        id: 2,
        text: 'The Great Wall of China is visible from space',
        verdict: 'refuted',
        confidence: 'high',
        explanation: 'Astronauts have confirmed the Great Wall is not visible to the naked eye from low Earth orbit. It is too narrow.',
        sources: [
          { title: 'NASA', url: 'https://www.nasa.gov/vision/space/workinginspace/great_wall.html', snippet: 'The Great Wall can barely be seen from the Shuttle, so it would not be possible to see it from the Moon...' }
        ]
      },
      {
        id: 3,
        text: 'We swallow an average of 8 spiders per year while sleeping',
        verdict: 'refuted',
        confidence: 'high',
        explanation: 'This statistic has no scientific basis and was likely created to demonstrate how false facts spread on the internet.',
        sources: [
          { title: 'Snopes', url: 'https://www.snopes.com/fact-check/swallow-spiders/', snippet: 'The claim that people swallow eight spiders a year appears to have no basis in fact...' }
        ]
      }
    ],
    transcript_preview: 'Did you know that humans only use 10% of their brain? That\'s why some people seem smarter...',
    cached: true
  },

  // Demo 3: Tech news (mostly supported)
  'demo_tech_facts': {
    videoId: 'demo_tech_facts',
    status: 'success',
    metadata: { title: 'AI Is Taking Over Everything', channel: 'TechInsider' },
    overallScore: 0.83,
    claims: [
      {
        id: 1,
        text: 'OpenAI released GPT-4 in March 2023',
        verdict: 'supported',
        confidence: 'high',
        explanation: 'GPT-4 was officially released by OpenAI on March 14, 2023.',
        sources: [
          { title: 'OpenAI Blog', url: 'https://openai.com/research/gpt-4', snippet: 'We\'ve created GPT-4, the latest milestone in OpenAI\'s effort in scaling up deep learning...' }
        ]
      },
      {
        id: 2,
        text: 'GPT-4 can pass the bar exam in the top 10 percent',
        verdict: 'supported',
        confidence: 'high',
        explanation: 'OpenAI reported that GPT-4 scored in the 90th percentile on the Uniform Bar Examination.',
        sources: [
          { title: 'OpenAI Technical Report', url: 'https://arxiv.org/abs/2303.08774', snippet: 'GPT-4 exhibits human-level performance on various professional and academic benchmarks...' }
        ]
      },
      {
        id: 3,
        text: 'AI could automate 50% of jobs by 2030',
        verdict: 'unclear',
        confidence: 'low',
        explanation: 'Various estimates exist but 50% by 2030 is on the higher end. Most studies suggest 15-30% of tasks could be automated.',
        sources: [
          { title: 'McKinsey Global Institute', url: 'https://www.mckinsey.com/featured-insights/future-of-work', snippet: 'About half of all work activities could be automated using current technology...' }
        ],
        what_to_check_next: 'Compare multiple economic forecasts on AI automation timelines'
      }
    ],
    transcript_preview: 'Breaking news: OpenAI released GPT-4 in March 2023 and it can pass the bar exam...',
    cached: true
  },

  // Demo 4: History facts (all supported)
  'demo_history_facts': {
    videoId: 'demo_history_facts',
    status: 'success',
    metadata: { title: 'History Facts They Don\'t Teach You', channel: 'HistoryUnveiled' },
    overallScore: 1.0,
    claims: [
      {
        id: 1,
        text: 'Napoleon was 5 foot 7, which was average height for his time',
        verdict: 'supported',
        confidence: 'high',
        explanation: 'Historical records show Napoleon was about 5\'7" (170cm), which was average or slightly above average for French men in the early 1800s.',
        sources: [
          { title: 'Smithsonian Magazine', url: 'https://www.smithsonianmag.com/history/napoleon-not-short-180969728/', snippet: 'Napoleon was actually of average height for his era...' }
        ]
      },
      {
        id: 2,
        text: 'Vikings did not wear horned helmets',
        verdict: 'supported',
        confidence: 'high',
        explanation: 'Archaeological evidence shows no horned helmets. The myth originated from 19th-century romantic art and opera costumes.',
        sources: [
          { title: 'History.com', url: 'https://www.history.com/news/did-vikings-really-wear-horned-helmets', snippet: 'There is no evidence that Vikings wore horned helmets...' }
        ]
      },
      {
        id: 3,
        text: 'Ada Lovelace was the first computer programmer in the 1840s',
        verdict: 'supported',
        confidence: 'high',
        explanation: 'Ada Lovelace wrote the first algorithm intended for a machine (Babbage\'s Analytical Engine) in 1843.',
        sources: [
          { title: 'Computer History Museum', url: 'https://computerhistory.org/profile/ada-lovelace/', snippet: 'Ada Lovelace is often regarded as the first computer programmer...' }
        ]
      }
    ],
    transcript_preview: 'Napoleon wasn\'t actually short - he was 5 foot 7, which was average height for his time...',
    cached: true
  },

  // Demo 5: No transcript available
  'demo_no_transcript': {
    videoId: 'demo_no_transcript',
    status: 'no_transcript',
    metadata: { title: 'Visual Only Short', channel: 'SilentCreator' },
    overallScore: null,
    claims: [],
    transcript_preview: null,
    cached: true
  }
};

export async function POST(req: NextRequest) {
  let videoId = 'unknown';
  
  try {
    const body = await req.json();
    videoId = body.videoId;
    const priority = body.priority || 'high';
    const clientTranscript = body.transcript; // NEW: client can provide transcript

    if (!videoId || typeof videoId !== 'string') {
      return NextResponse.json(
        { 
          videoId: 'unknown',
          status: 'error', 
          metadata: { title: '', channel: '' },
          overallScore: null,
          claims: [],
          transcript_preview: null,
          cached: false,
          error: 'Missing videoId' 
        }, 
        { status: 400 }
      );
    }

    console.log(`[Analyze] Processing videoId: ${videoId}, priority: ${priority}`);
    console.log(`[Analyze] Client transcript provided: ${clientTranscript ? 'yes' : 'no'}`);

    // Check demo cache first
    if (DEMO_RESULTS[videoId]) {
      console.log(`[Analyze] Returning demo result for ${videoId}`);
      return NextResponse.json({ ...DEMO_RESULTS[videoId], cached: true });
    }

    // Check runtime cache
    if (cache.has(videoId)) {
      console.log(`[Analyze] Returning cached result for ${videoId}`);
      return NextResponse.json({ ...cache.get(videoId), cached: true });
    }

    // Step 1: Use client-provided transcript, or try server-side as fallback
    let metadata: { title: string; channel: string };
    let transcript: { found: boolean; text: string };

    if (clientTranscript && clientTranscript.length > 0) {
      // Client (extension) sent the transcript — use it directly
      console.log(`[Analyze] Using client-provided transcript (${clientTranscript.length} chars)`);
      transcript = { found: true, text: clientTranscript };
      // Still need metadata — try to get it, but don't fail if we can't
      try {
        const videoData = await fetchVideoData(videoId);
        metadata = videoData.metadata;
      } catch {
        metadata = { title: '', channel: '' };
      }
    } else {
      // Fallback: try server-side extraction (may fail due to YouTube restrictions)
      console.log(`[Analyze] Attempting server-side transcript extraction...`);
      const videoData = await fetchVideoData(videoId);
      metadata = videoData.metadata;
      transcript = videoData.transcript;
    }
    
    console.log(`[Analyze] Metadata: ${metadata.title} by ${metadata.channel}`);
    console.log(`[Analyze] Transcript found: ${transcript.found}, length: ${transcript.text.length}`);

    // No transcript → return early
    if (!transcript.found) {
      const response: AnalysisResponse = {
        videoId,
        status: 'no_transcript',
        metadata,
        overallScore: null,
        claims: [],
        transcript_preview: null,
        cached: false
      };
      cache.set(videoId, response);
      return NextResponse.json(response);
    }

    // Step 2: Extract claims + generate search queries (LLM call #1)
    console.log(`[Analyze] Extracting claims...`);
    const { claims, searchQueries } = await extractClaims(transcript.text, metadata);
    console.log(`[Analyze] Extracted ${claims.length} claims, ${searchQueries.length} search queries`);

    // If no verifiable claims found, return early
    if (claims.length === 0) {
      const response: AnalysisResponse = {
        videoId,
        status: 'success',
        metadata,
        overallScore: null,
        claims: [],
        transcript_preview: transcript.text.slice(0, 200),
        cached: false
      };
      cache.set(videoId, response);
      return NextResponse.json(response);
    }

    // Step 3: Web search (1-2 queries, parallel)
    console.log(`[Analyze] Searching web for evidence...`);
    const searchResults = await searchWeb(searchQueries);
    console.log(`[Analyze] Found ${searchResults.length} search results`);

    // Step 4: Verify claims against evidence (LLM call #2)
    console.log(`[Analyze] Verifying claims...`);
    const verifiedClaims = await verifyClaims(claims, searchResults);
    console.log(`[Analyze] Verified ${verifiedClaims.length} claims`);

    // Step 5: Compute overall score
    const overallScore = computeOverallScore(verifiedClaims);
    console.log(`[Analyze] Overall score: ${overallScore}`);

    const response: AnalysisResponse = {
      videoId,
      status: 'success',
      metadata,
      overallScore,
      claims: verifiedClaims,
      transcript_preview: transcript.text.slice(0, 200),
      cached: false
    };

    cache.set(videoId, response);

    return NextResponse.json(response, {
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (error: unknown) {
    console.error('[Analyze] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      videoId,
      status: 'error',
      metadata: { title: '', channel: '' },
      overallScore: null,
      claims: [],
      transcript_preview: null,
      cached: false,
      error: errorMessage
    }, { status: 500 });
  }
}

// Handle CORS preflight
export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
