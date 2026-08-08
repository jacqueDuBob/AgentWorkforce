export interface RefinementQuestion {
  id: string;
  question: string;
  suggestions: [string, string, string];
}

export interface RefinementProposal {
  repositoryId: string;
  repositoryReason: string;
  questions: RefinementQuestion[];
}

export interface RefinementAnswer {
  questionId: string;
  question: string;
  answer: string;
}

export interface RefinedTicketContent {
  title: string;
  description: string;
  acceptanceCriteria: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  tags: string[];
}
