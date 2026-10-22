import { test, expect } from '@playwright/test';
import { buildGreeting, getFirstName, isEchoOfGreeting, normalizeForEcho } from '../src/lib/greeting';

test.describe('STYL-185: buildGreeting unit tests', () => {
  test('"Hi, you\'re through to FloChat at StyleFlo AI. How can I help you today?" with "Ops Manager"', () => {
    const greeting = buildGreeting({
      welcomeMessage: "Hi, you're through to FloChat at StyleFlo AI. How can I help you today?",
      agentName: 'FloChat',
      businessName: 'StyleFlo AI',
      clientName: 'Ops Manager',
    });
    expect(greeting).toBe("Hi Ops, you're through to FloChat at StyleFlo AI. How can I help you today?");
  });

  test('"Hello! How can I help you today?" with "sarah"', () => {
    const greeting = buildGreeting({
      welcomeMessage: 'Hello! How can I help you today?',
      agentName: 'AI Assistant',
      businessName: 'StyleFlo AI',
      clientName: 'sarah',
    });
    expect(greeting).toBe('Hi Sarah, how can I help you today?');
  });

  test('"Welcome to Bella\'s Salon." with "Tom"', () => {
    const greeting = buildGreeting({
      welcomeMessage: "Welcome to Bella's Salon.",
      agentName: 'Emma',
      businessName: "Bella's Salon",
      clientName: 'Tom',
    });
    expect(greeting).toBe("Hi Tom, welcome to Bella's Salon.");
  });

  test('messages starting with "I\'m Emma..." and "FloChat here..." keep their capitals', () => {
    const imEmma = buildGreeting({
      welcomeMessage: "I'm Emma, how can I help you today?",
      agentName: 'Emma',
      businessName: "Bella's Salon",
      clientName: 'Sarah',
    });
    expect(imEmma).toBe("Hi Sarah, I'm Emma, how can I help you today?");

    const floChatHere = buildGreeting({
      welcomeMessage: 'FloChat here, how can I help you today?',
      agentName: 'FloChat',
      businessName: 'StyleFlo AI',
      clientName: 'Sarah',
    });
    expect(floChatHere).toBe('Hi Sarah, FloChat here, how can I help you today?');
  });

  test('placeholder "Hello [Name], welcome back" with "Ann" gives "Hello Ann, welcome back" without double greeting', () => {
    const greeting = buildGreeting({
      welcomeMessage: 'Hello [Name], welcome back',
      agentName: 'Emma',
      businessName: "Bella's Salon",
      clientName: 'Ann',
    });
    expect(greeting).toBe('Hello Ann, welcome back');
  });

  test('no name: returns message unchanged, removes placeholders cleanly, never introduces "there" or "null"', () => {
    const regular = buildGreeting({
      welcomeMessage: "Welcome to Bella's Salon. How can I help you today?",
      agentName: 'Emma',
      businessName: "Bella's Salon",
      clientName: null,
    });
    expect(regular).toBe("Welcome to Bella's Salon. How can I help you today?");
    expect(regular).not.toContain('there');
    expect(regular).not.toContain('null');

    const withPlaceholder = buildGreeting({
      welcomeMessage: 'Hello [Name], welcome back',
      agentName: 'Emma',
      businessName: "Bella's Salon",
      clientName: '',
    });
    expect(withPlaceholder).toBe('Hello, welcome back');
    expect(withPlaceholder).not.toContain('there');
    expect(withPlaceholder).not.toContain('null');
  });

  test('empty welcome message with agent "Emma" and business "Bella\'s Salon"', () => {
    const withoutName = buildGreeting({
      welcomeMessage: '',
      agentName: 'Emma',
      businessName: "Bella's Salon",
      clientName: null,
    });
    expect(withoutName).toBe("Hi, I'm Emma, the AI assistant for Bella's Salon. How can I help you today?");

    const withName = buildGreeting({
      welcomeMessage: '',
      agentName: 'Emma',
      businessName: "Bella's Salon",
      clientName: 'Tom',
    });
    expect(withName).toBe("Hi Tom, I'm Emma, the AI assistant for Bella's Salon. How can I help you today?");
  });

  test('name containing HTML tags produces no HTML', () => {
    const firstName = getFirstName('<img src=x onerror=alert(1)>');
    expect(firstName).toBeNull();

    const greeting = buildGreeting({
      welcomeMessage: "Welcome to Bella's Salon.",
      agentName: 'Emma',
      businessName: "Bella's Salon",
      clientName: '<img src=x onerror=alert(1)>',
    });
    expect(greeting).toBe("Welcome to Bella's Salon.");
    expect(greeting).not.toContain('<img');
    expect(greeting).not.toContain('onerror');
  });

  test('isEchoOfGreeting detects speech matches against the actual greeting', () => {
    const greeting = "Hi Ops, you're through to FloChat at StyleFlo AI. How can I help you today?";
    expect(isEchoOfGreeting("you're through to FloChat at StyleFlo AI", greeting)).toBe(true);
    expect(isEchoOfGreeting("Hi Ops, you're through to FloChat at StyleFlo AI. How can I help you today?", greeting)).toBe(true);
    expect(isEchoOfGreeting("I would like to book a cut and blow dry please", greeting)).toBe(false);
  });
});
