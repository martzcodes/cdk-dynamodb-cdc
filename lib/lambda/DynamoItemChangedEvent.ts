export interface DynamoItemChangedEvent {
  after: { [key: string]: any };
  attributesChanged: string[];
  before: { [key: string]: any };
  imagesUrl?: string; // S3 URL to Old and New Images
  newImage?: { [key: string]: any };
  oldImage?: { [key: string]: any };
  operation: string; // 'INSERT' | 'MODIFY' | 'REMOVE'
  pk: string;
  platformId?: string;
  sk: string;
}
