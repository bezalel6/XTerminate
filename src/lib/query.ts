/**
 * Type definitions for Query functionality
 */

export type QueryProps = readonly [string, ...string[]] | [string, ...string[]] | string; // At least one selector required
type SrcElement = Element | Document | ParentNode;
type QueryResult<R extends HTMLElement> = R & { query: QueryFunc; _debugSelector?: string };
type NullableResult<R extends HTMLElement> = QueryResult<R> | null;

/**
 * Function signature for query methods
 */
interface QueryFunc {
  <R extends HTMLElement>(selectors: QueryProps): NullableResult<R>;
}

type ElementPredicate = (element: Element) => boolean;

/**
 * Configuration for pseudo-selector templates
 */
interface PseudoSelectorConfig {
  prefix: string;
  suffix: string;
  valueWrapper: string;
}

type GenerateSelector = (selector: typeof Query) => string;

type Smuggle = { property: string; value: string };
/**
 * Query class provides a fluent interface for DOM manipulation and traversal
 * with chainable methods and extended functionality
 */
class Query {
  /**
   * Default template configuration for pseudo-selectors
   */
  private static defaultTemplate: PseudoSelectorConfig = {
    prefix: 'advanced-selector-',
    suffix: '',
    valueWrapper: '"',
  };

  /**
   * Current template configuration
   */
  private static template: PseudoSelectorConfig = { ...Query.defaultTemplate };

  /**
   * Registry of custom pseudo-selectors and their implementations
   */
  private static readonly pseudoSelectors: Record<string, (value: string) => ElementPredicate> = {
    // Find elements containing specific text
    contains: (text: string) => (element: Element) =>
      element.textContent?.toLowerCase().includes(text.toLowerCase()) || false,

    // Find elements containing any of the provided texts
    containsAny: (texts: string) => (element: Element) => {
      const searchTexts = texts.split(',').map(t => t.trim().toLowerCase());
      const elementText = element.textContent?.toLowerCase() || '';
      return searchTexts.some(text => elementText.includes(text));
    },

    // Find elements with exact text match
    exact: (text: string) => (element: Element) => element.textContent?.trim() === text.trim(),

    // Find elements where text starts with value
    startsWith: (text: string) => (element: Element) =>
      element.textContent?.toLowerCase().trim().startsWith(text.toLowerCase()) || false,

    // Find elements where text ends with value
    endsWith: (text: string) => (element: Element) =>
      element.textContent?.toLowerCase().trim().endsWith(text.toLowerCase()) || false,

    // Query the element itself using a selector
    self: (selector: string) => (element: Element) => element.matches(selector),

    // Find if element has a closest ancestor matching selector
    closest: (selector: string) => (element: Element) => !!element.closest(selector),

    smuggleIf: (stringified: string) => element => {
      const { selector, whenMatch, whenNoMatch } = JSON.parse(stringified) as {
        selector: QueryProps;
        whenMatch: Smuggle;
        whenNoMatch: Smuggle;
      };
      if (Query.from(element).query(selector)) {
        console.log('smuggle if matched', element);
        if (whenMatch) element[whenMatch.property] = whenMatch.value;
      } else {
        if (whenNoMatch) element[whenNoMatch.property] = whenNoMatch.value;
      }
      return false;
    },
  };

  /**
   * Create a new Query instance with the given root element
   * @param root The root element to query within
   */
  constructor(readonly root: SrcElement) {
    // Make the instance callable as a function through Proxy
    return new Proxy(this, {
      apply: (target, _, args) => {
        return target.query(args as QueryProps);
      },
    });
  }

  /**
   * Get the root element as an HTMLElement
   */
  get src(): HTMLElement {
    return this.root as HTMLElement;
  }
  static parseSelectors(selectors: QueryProps) {
    return typeof selectors === 'string' ? [selectors] : selectors;
  }
  /**
   * Check if a selector contains advanced selector patterns
   * @param selector The selector to check
   * @returns True if the selector contains advanced patterns
   */
  static hasAdvancedSelector(selector: string): boolean {
    const template = Query.getTemplate();
    const { prefix, suffix } = template;
    const pattern = new RegExp(`${prefix}[a-zA-Z]+${suffix}\\(`, 'g');
    return pattern.test(selector);
  }

  /**
   * Query for a single element that matches the selector(s)
   * @param selectors One or more CSS selectors to match against
   * @returns A wrapped element or null if not found
   */
  query<R extends HTMLElement>(_selectors: QueryProps): NullableResult<R> {
    const selectors = Query.parseSelectors(_selectors);
    for (const selector of selectors) {
      // Check if any part of the selector contains advanced patterns
      if (Query.hasAdvancedSelector(selector)) {
        const result = Query.advancedQuery<R>(this.root as Element | Document, selector);
        if (result) return Query.res<R>(result, selector);
        continue;
      }

      const result = this.root.querySelector(selector);
      if (result) return Query.res<R>(result, selector);
    }
    return null;
  }
  /**
   * Query for all elements that match the selector(s)
   * @param selectors One or more CSS selectors to match against
   * @returns An array of wrapped elements
   */
  queryAll<R extends HTMLElement>(_selectors: QueryProps, greedy = true): QueryResult<R>[] {
    const selectors = Query.parseSelectors(_selectors);
    const results: QueryResult<R>[] = [];
    for (const selector of selectors) {
      const greedAdjustedQuery = (advanced: boolean) => {
        const inner = () => {
          if (advanced) {
            return greedy
              ? Query.advancedQueryAll(this.src, selector)
              : [Query.advancedQuery(this.src, selector)];
          }
          return greedy
            ? Array.from(this.src.querySelectorAll<R>(selector))
            : [this.src.querySelector<R>(selector)];
        };
        return inner()
          .map(result => Query.res<R>(result, selector))
          .filter((el): el is QueryResult<R> => el !== null);
      };

      results.push(...greedAdjustedQuery(Query.hasAdvancedSelector(selector)));
    }

    // Remove duplicates by using a Set
    return Array.from(new Set(results));
  }

  /**
   * Find the closest ancestor that matches the selector(s)
   * @param selectors One or more CSS selectors to match against
   * @returns A wrapped element or null if not found
   */
  closest<R extends HTMLElement>(selectors: QueryProps): NullableResult<R> {
    const selectorList = Query.parseSelectors(selectors);
    return Query.res<R>(this.src.closest(selectorList.join(', ')));
  }
  //#region unused
  /**
   * Find all children that match the selector(s)
   * @param selectors One or more CSS selectors to match against
   * @returns An array of wrapped elements
   */
  children<R extends HTMLElement>(selectors: QueryProps): QueryResult<R>[] {
    const selectorList = Query.parseSelectors(selectors);
    const selector = selectorList.join(', ');
    return Array.from(this.src.children)
      .filter(child => child.matches(selector))
      .map(el => Query.res<R>(el, selector))
      .filter((el): el is QueryResult<R> => el !== null);
  }

  /**
   * Find all sibling elements that match the selector(s)
   * @param selectors One or more CSS selectors to match against
   * @returns An array of wrapped elements
   */
  siblings<R extends HTMLElement>(selectors: QueryProps): QueryResult<R>[] {
    const selectorList = Query.parseSelectors(selectors);
    const selector = selectorList.join(', ');
    const element = this.src;
    const parent = element.parentElement;

    if (!parent) return [];

    return Array.from(parent.children)
      .filter(child => child !== element && child.matches(selector))
      .map(el => Query.res<R>(el, selector))
      .filter((el): el is QueryResult<R> => el !== null);
  }

  /**
   * Find the parent element
   * @returns A wrapped parent element or null if not found
   */
  parent<R extends HTMLElement>(): NullableResult<R> {
    return Query.res<R>(this.src.parentElement);
  }

  /**
   * Find all parent elements up to an optional selector
   * @param selector Optional CSS selector to stop at
   * @returns An array of wrapped parent elements
   */
  parents<R extends HTMLElement>(selector?: string): QueryResult<R>[] {
    const result: Element[] = [];
    let current = this.src.parentElement;

    while (current) {
      if (selector) {
        if (current.matches(selector)) {
          result.push(current);
        }
      } else {
        result.push(current);
      }
      current = current.parentElement;
    }

    return result
      .map(el => Query.res<R>(el, selector))
      .filter((el): el is QueryResult<R> => el !== null);
  }

  /**
   * Add event listener to the current element
   * @param type Event type
   * @param listener Event listener function
   * @param options Event listener options
   * @returns This query instance for chaining
   */
  on<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): this {
    this.src.addEventListener(type, listener, options);
    return this;
  }

  /**
   * Remove event listener from the current element
   * @param type Event type
   * @param listener Event listener function
   * @param options Event listener options
   * @returns This query instance for chaining
   */
  off<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any,
    options?: boolean | EventListenerOptions
  ): this {
    this.src.removeEventListener(type, listener, options);
    return this;
  }

  /**
   * Add CSS classes to the current element
   * @param classes One or more CSS classes to add
   * @returns This query instance for chaining
   */
  addClass(...classes: string[]): this {
    this.src.classList.add(...classes);
    return this;
  }

  /**
   * Remove CSS classes from the current element
   * @param classes One or more CSS classes to remove
   * @returns This query instance for chaining
   */
  removeClass(...classes: string[]): this {
    this.src.classList.remove(...classes);
    return this;
  }

  /**
   * Toggle CSS classes on the current element
   * @param classes One or more CSS classes to toggle
   * @returns This query instance for chaining
   */
  toggleClass(...classes: string[]): this {
    classes.forEach(cls => this.src.classList.toggle(cls));
    return this;
  }

  /**
   * Check if the current element has a CSS class
   * @param className CSS class to check for
   * @returns True if the element has the class, false otherwise
   */
  hasClass(className: string): boolean {
    return this.src.classList.contains(className);
  }

  /**
   * Get or set the text content of the current element
   * @param value Optional text content to set
   * @returns The text content if getting, or this query instance if setting
   */
  text(value?: string): string | this {
    if (value === undefined) {
      return this.src.textContent || '';
    }
    this.src.textContent = value;
    return this;
  }

  /**
   * Get or set the HTML content of the current element
   * @param value Optional HTML content to set
   * @returns The HTML content if getting, or this query instance if setting
   */
  html(value?: string): string | this {
    if (value === undefined) {
      return this.src.innerHTML;
    }
    this.src.innerHTML = value;
    return this;
  }

  /**
   * Get or set an attribute on the current element
   * @param name Attribute name
   * @param value Optional attribute value to set
   * @returns The attribute value if getting, or this query instance if setting
   */
  attr(name: string, value?: string): string | null | this {
    if (value === undefined) {
      return this.src.getAttribute(name);
    }
    this.src.setAttribute(name, value);
    return this;
  }

  /**
   * Remove an attribute from the current element
   * @param name Attribute name to remove
   * @returns This query instance for chaining
   */
  removeAttr(name: string): this {
    this.src.removeAttribute(name);
    return this;
  }

  /**
   * Get or set a data attribute on the current element
   * @param key Data attribute key (without 'data-' prefix)
   * @param value Optional data attribute value to set
   * @returns The data attribute value if getting, or this query instance if setting
   */
  data(key: string, value?: string): string | null | this {
    const dataKey = `data-${key}`;
    if (value === undefined) {
      return this.src.getAttribute(dataKey);
    }
    this.src.setAttribute(dataKey, value);
    return this;
  }

  /**
   * Get or set CSS properties on the current element
   * @param prop CSS property name or object of properties
   * @param value Optional CSS property value to set
   * @returns The CSS property value if getting, or this query instance if setting
   */
  css(prop: string | Record<string, string>, value?: string): string | this {
    if (typeof prop === 'string') {
      if (value === undefined) {
        return getComputedStyle(this.src).getPropertyValue(prop);
      }
      this.src.style.setProperty(prop, value);
      return this;
    }

    // Handle object of properties
    Object.entries(prop).forEach(([key, val]) => {
      this.src.style.setProperty(key, val);
    });
    return this;
  }
  //#endregion
  /**
   * Wrap an element for query chaining
   * @param res Element to wrap
   * @returns A wrapped element or null if the input is falsy
   */
  protected static res<R extends HTMLElement>(
    res: Element | null,
    selector?: string
  ): NullableResult<R> {
    if (!res) return null;

    const t = res as QueryResult<R>;
    t.query = (...s) => Query.from(t).query(...s);
    if (selector) {
      t._debugSelector = selector;
    }
    return t;
  }

  /**
   * Create a new Query instance from an element
   * @param element Source element
   * @returns A new Query instance
   */
  static from(element: SrcElement): Query {
    return new Query(element);
  }

  /**
   * Create a Query instance from a selector or default root
   * @param root Root element or selector
   * @returns A new Query instance
   */
  static $(root: SrcElement | string = document): Query {
    if (typeof root === 'string') {
      const element = document.querySelector(root);
      return new Query(element || document);
    }
    return new Query(root);
  }
  static $$() {
    return (selector: GenerateSelector) => {
      // Pass the selector to the function and return the result
      return selector(Query);
    };
  }

  /**
   * Configure the template for pseudo-selectors
   * @param config Partial configuration to apply
   */
  static configureTemplate(config: Partial<PseudoSelectorConfig>): void {
    this.template = { ...this.template, ...config };
  }

  /**
   * Reset template configuration to defaults
   */
  static resetTemplate(): void {
    this.template = { ...this.defaultTemplate };
  }

  /**
   * Get current template configuration
   */
  static getTemplate(): PseudoSelectorConfig {
    return { ...this.template };
  }

  /**
   * Get the pattern regex for pseudo-selectors
   */
  private static getPatternRegex() {
    const { prefix, suffix, valueWrapper } = this.template;
    return new RegExp(
      `${prefix}([a-zA-Z]+)${suffix}\\(${valueWrapper}(.*?)${valueWrapper}\\)`,
      'g'
    );
  }

  /**
   * Parse a selector string into base selector and pseudo-selectors
   * @param selector Full selector string
   * @returns Object with baseSelector and array of predicates
   */
  private static parseSelector(selector: string): {
    baseSelector: string;
    pseudos: ElementPredicate[];
  } {
    const pattern = this.getPatternRegex();
    const pseudos: ElementPredicate[] = [];

    const baseSelector = selector
      .replace(pattern, (match, name, value) => {
        if (this.pseudoSelectors[name]) {
          pseudos.push(this.pseudoSelectors[name](value));
        } else {
          console.warn(`Unknown pseudo-selector: ${name}`);
        }
        return '';
      })
      .trim();
    return { baseSelector, pseudos };
  }

  /**
   * Register a new custom pseudo-selector
   * @param name Name of the pseudo-selector (without the colon)
   * @param handler Function that returns an element predicate
   */
  static register(name: string, handler: (value: string) => ElementPredicate): void {
    this.pseudoSelectors[name] = handler;
  }

  // Convenience methods for common pseudo-selectors
  static contains(text: string): string {
    const { prefix, suffix, valueWrapper } = this.template;
    return `${prefix}contains${suffix}(${valueWrapper}${text}${valueWrapper})`;
  }

  static containsAny(...texts: string[]): string {
    const { prefix, suffix, valueWrapper } = this.template;
    return `${prefix}containsAny${suffix}(${valueWrapper}${texts.join(',')}${valueWrapper})`;
  }

  static exact(text: string): string {
    const { prefix, suffix, valueWrapper } = this.template;
    return `${prefix}exact${suffix}(${valueWrapper}${text}${valueWrapper})`;
  }

  static startsWith(text: string): string {
    const { prefix, suffix, valueWrapper } = this.template;
    return `${prefix}startsWith${suffix}(${valueWrapper}${text}${valueWrapper})`;
  }

  static endsWith(text: string): string {
    const { prefix, suffix, valueWrapper } = this.template;
    return `${prefix}endsWith${suffix}(${valueWrapper}${text}${valueWrapper})`;
  }

  static self(selector: string): string {
    const { prefix, suffix, valueWrapper } = this.template;
    return `${prefix}self${suffix}(${valueWrapper}${selector}${valueWrapper})`;
  }

  static closest(selector: string): string {
    const { prefix, suffix, valueWrapper } = this.template;
    return `${prefix}closest${suffix}(${valueWrapper}${selector}${valueWrapper})`;
  }

  static smuggleIf(
    selector: QueryProps,
    whenMatch: Smuggle | undefined,
    whenNoMatch: Smuggle | undefined
  ): string {
    const { prefix, suffix, valueWrapper } = this.template;
    const config = JSON.stringify({ selector, whenMatch, whenNoMatch });
    return `${prefix}smuggleIf${suffix}(${valueWrapper}${config}${valueWrapper})`;
  }

  /**
   * Performs a query with advanced selector support
   * @param root The root element to search within
   * @param selector The CSS selector, potentially with custom pseudo-selectors
   * @returns The matching element or null
   */
  private static advancedQuery<R extends HTMLElement>(
    root: Element | Document,
    selector: string
  ): R | null {
    const { baseSelector, pseudos } = this.parseSelector(selector);
    // First, get all elements matching the base selector
    const candidates = Array.from(
      baseSelector.trim().length ? root.querySelectorAll<R>(baseSelector) : [root as R]
    );
    // If no custom pseudo-selectors, return the first match
    if (pseudos.length === 0) {
      return candidates[0] || null;
    }

    // Apply all custom pseudo-selectors
    const match = candidates.find(element => pseudos.every(pseudo => pseudo(element)));

    return match || null;
  }

  /**
   * Performs an advanced selector query for all elements
   * @param root The root element to search within
   * @param selector The CSS selector, potentially with custom pseudo-selectors
   * @returns Array of matching elements
   */
  private static advancedQueryAll<R extends HTMLElement>(
    root: Element | Document,
    selector: string
  ): R[] {
    const { baseSelector, pseudos } = this.parseSelector(selector);

    // First, get all elements matching the base selector
    const candidates = Array.from(root.querySelectorAll<R>(baseSelector));

    // If no custom pseudo-selectors, return all matches
    if (pseudos.length === 0) {
      return candidates;
    }

    // Apply all custom pseudo-selectors and filter
    return candidates.filter(element => pseudos.every(pseudo => pseudo(element)));
  }
}

// Ensure that the Query interface includes the QueryFunc interface
// This is necessary for TypeScript to understand the callable functionality
interface Query extends QueryFunc {
  advancedQuery<R extends HTMLElement>(selector: string): R | null;
  advancedQueryAll<R extends HTMLElement>(selector: string): R[];
}

export default Query;
