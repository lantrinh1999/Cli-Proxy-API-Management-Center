export type ModelMappingMode = 'exact' | 'wildcard' | 'regex';

export interface ModelMappingRule {
  match: string;
  target: string;
  mode: ModelMappingMode;
  enabled: boolean;
  forceMapping: boolean;
}
