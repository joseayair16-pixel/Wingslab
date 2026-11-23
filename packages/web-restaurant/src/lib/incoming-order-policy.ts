/** Decidir la presentación sin activar decisiones automáticas en WingsLab. */
export function incomingOrderDisposition(options: {
  resolved: boolean;
  prompted: boolean;
  automaticDecisions: boolean;
  expiresAt: number;
  now: number;
}): 'ignore' | 'reject' | 'prompt' {
  if (options.resolved) return 'ignore';
  if (options.automaticDecisions && options.expiresAt <= options.now) return 'reject';
  return options.prompted ? 'ignore' : 'prompt';
}
