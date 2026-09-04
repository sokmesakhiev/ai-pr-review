export type Provider = 'openai' | 'anthropic' | 'gemini';

export interface ActionConfig {
  apiKey: string;
  githubToken: string;
  provider: Provider;
  model: string;
  reasoningEffort: string;
  maxFiles: number;
  maxPatchChars: number;
  postMode: 'review' | 'comment';
  failOnError: boolean;
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface DiffFile {
  filename: string;
  status: string;
  patch?: string;
  additions: number;
  deletions: number;
}

export interface ReviewComment {
  path: string;
  line: number;
  side?: 'LEFT' | 'RIGHT';
  severity: 'info' | 'suggestion' | 'warning' | 'blocker';
  body: string;
}

export interface ReviewResult {
  summary: string;
  overallRecommendation: 'approve' | 'comment' | 'request_changes';
  comments: ReviewComment[];
  modelUsed: string;
}

export interface RequestReviewParams {
  apiKey: string;
  model: string;
  reasoningEffort: string;
  files: DiffFile[];
  truncatedFileCount: number;
}

export interface ReviewProviderClient {
  requestReview(params: RequestReviewParams): Promise<ReviewResult>;
}
