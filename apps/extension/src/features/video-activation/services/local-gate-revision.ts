/** Invalidates delayed startup/storage work when a newer gate command arrives. */
export class LocalGateRevision {
  private value = 0;

  public snapshot(): number { return this.value; }
  public invalidate(): number { return ++this.value; }
  public isCurrent(snapshot: number): boolean { return snapshot === this.value; }
}
