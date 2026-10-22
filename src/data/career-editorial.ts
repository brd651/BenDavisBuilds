import { careerStages } from './career';
import type { CareerStage } from './career';

export type CareerArtifactKind = 'reproduction' | 'automation' | 'archive';
export interface CareerReflection { text: string; artifact?: CareerArtifactKind }

// The experiment relocates exact existing passages into visible field notes.
// Keep canonical career data unchanged, and fail the build if its source moves.
const selections: Readonly<Record<string, { sentence?: string; detail?: string; artifact?: CareerArtifactKind }>> = {
  'marine-corps': { sentence: 'It also gave me the habit of wanting to understand the full picture, not just the symptom in front of me.' },
  education: { sentence: 'From there, I moved into technical roles where I could keep learning by doing.' },
  sonicwall: { detail: 'Test the assumptions', artifact: 'reproduction' },
  'western-nrg': { sentence: 'I wanted to make solving the next problem easier too.', artifact: 'automation' },
  sophos: { detail: 'People, consistency and scale' },
  'palo-alto-networks': { detail: 'Create the conditions for strong engineering' },
  'ben-davis-builds': { sentence: 'Some of it is simply about following curiosity and seeing what can be learned by building.', artifact: 'archive' },
};

export const careerReflections: Record<string, CareerReflection> = {};
export const editorialCareerStages: readonly CareerStage[] = careerStages.map(stage => {
  const selection = selections[stage.id];
  if (!selection) throw new Error(`Missing editorial selection for ${stage.id}`);
  if (selection.sentence) {
    if (!stage.summary.includes(selection.sentence)) throw new Error(`Carry-forward source changed: ${stage.id}`);
    careerReflections[stage.id] = { text: selection.sentence, artifact: selection.artifact };
    return { ...stage, summary: stage.summary.replace(selection.sentence, '').trim() };
  }
  const detail = stage.expansion?.sections.find(section => section.heading === selection.detail);
  if (!detail || !stage.expansion) throw new Error(`Carry-forward detail changed: ${stage.id}`);
  careerReflections[stage.id] = { text: detail.body, artifact: selection.artifact };
  return { ...stage, expansion: { ...stage.expansion, sections: stage.expansion.sections.filter(section => section !== detail) } };
});
