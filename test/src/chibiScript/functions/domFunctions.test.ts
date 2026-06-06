import { expect } from 'chai';
import domFunctions from '../../../../src/chibiScript/functions/domFunctions';
import utilsFunctions from '../../../../src/chibiScript/functions/core/utilsFunctions';

/**
 * These guards make the chibi DOM accessors degrade gracefully when a selector
 * does not match (input is null/undefined) instead of throwing. The ChibiConsumer
 * already catches such throws and turns them into null, but each throw is logged
 * and the rest of the chain keeps re-throwing on the null. Returning a safe value
 * directly keeps the output identical while removing the log spam and wasted work.
 *
 * The accessors ignore the ChibiCtx argument, so a dummy ctx is sufficient here
 * and no DOM is required (the guards return before touching the DOM).
 */
const ctx = {} as any;

describe('DOM Functions - null-safe accessors', () => {
  const nullishCases = [
    ['null', null],
    ['undefined', undefined],
  ] as const;

  for (const [label, input] of nullishCases) {
    describe(`with ${label} input`, () => {
      it('find returns null', () => {
        expect(domFunctions.find(ctx, input as any, 'a')).to.equal(null);
      });

      it('findAll returns an empty array', () => {
        expect(domFunctions.findAll(ctx, input as any, 'a')).to.deep.equal([]);
      });

      it('text returns null', () => {
        expect(domFunctions.text(ctx, input as any)).to.equal(null);
      });

      it('html returns null', () => {
        expect(domFunctions.html(ctx, input as any)).to.equal(null);
      });

      it('elementValue returns null', () => {
        expect(domFunctions.elementValue(ctx, input as any)).to.equal(null);
      });

      it('selectedText returns null', () => {
        expect(domFunctions.selectedText(ctx, input as any)).to.equal(null);
      });

      it('getAttribute returns null', () => {
        expect(domFunctions.getAttribute(ctx, input as any, 'href')).to.equal(null);
      });

      it('getComputedStyle returns null', () => {
        expect(domFunctions.getComputedStyle(ctx, input as any, 'color')).to.equal(null);
      });

      it('setStyle returns null', () => {
        expect(domFunctions.setStyle(ctx, input as any, 'color', 'red')).to.equal(null);
      });

      it('closest returns null', () => {
        expect(domFunctions.closest(ctx, input as any, '.x')).to.equal(null);
      });

      it('parent returns null', () => {
        expect(domFunctions.parent(ctx, input as any)).to.equal(null);
      });

      it('next returns null', () => {
        expect(domFunctions.next(ctx, input as any)).to.equal(null);
      });

      it('prev returns null', () => {
        expect(domFunctions.prev(ctx, input as any)).to.equal(null);
      });

      it('elementMatches returns false', () => {
        expect(domFunctions.elementMatches(ctx, input as any, '.x')).to.equal(false);
      });

      it('getBaseText returns an empty string', () => {
        expect(utilsFunctions.getBaseText(ctx, input as any)).to.equal('');
      });
    });
  }
});
