'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ─── Smart local AI fallback (works without edge function or API key) ───
const CAPITALS: Record<string, string> = {
  india: 'New Delhi', france: 'Paris', japan: 'Tokyo', usa: 'Washington, D.C.',
  'united states': 'Washington, D.C.', uk: 'London', 'united kingdom': 'London',
  britain: 'London', china: 'Beijing', australia: 'Canberra', germany: 'Berlin',
  italy: 'Rome', spain: 'Madrid', russia: 'Moscow', brazil: 'Brasilia',
  canada: 'Ottawa', 'south korea': 'Seoul', 'south africa': 'Pretoria (executive), Cape Town (legislative), Bloemfontein (judicial)',
  mexico: 'Mexico City', thailand: 'Bangkok', vietnam: 'Hanoi', indonesia: 'Jakarta',
  malaysia: 'Kuala Lumpur', philippines: 'Manila', singapore: 'Singapore (city-state)',
  nepal: 'Kathmandu', 'sri lanka': 'Colombo (commercial), Sri Jayawardenepura Kotte (legislative)',
  bangladesh: 'Dhaka', pakistan: 'Islamabad', turkey: 'Ankara', egypt: 'Cairo',
  nigeria: 'Abuja', kenya: 'Nairobi', uae: 'Abu Dhabi', 'saudi arabia': 'Riyadh',
  israel: 'Jerusalem', argentina: 'Buenos Aires', colombia: 'Bogota', chile: 'Santiago',
  peru: 'Lima', sweden: 'Stockholm', norway: 'Oslo', denmark: 'Copenhagen',
  finland: 'Helsinki', netherlands: 'Amsterdam', belgium: 'Brussels', switzerland: 'Bern',
  austria: 'Vienna', portugal: 'Lisbon', greece: 'Athens', poland: 'Warsaw',
  'czech republic': 'Prague', ireland: 'Dublin', 'new zealand': 'Wellington',
  'south korea': 'Seoul', japan: 'Tokyo', myanmar: 'Naypyidaw', cambodia: 'Phnom Penh',
  laos: 'Vientiane', mongolia: 'Ulaanbaatar', afghanistan: 'Kabul', iran: 'Tehran',
  iraq: 'Baghdad', morocco: 'Rabat', ethiopia: 'Addis Ababa', tanzania: 'Dodoma',
  ghana: 'Accra', rwanda: 'Kigali', cuba: 'Havana', jamaica: 'Kingston',
};

const CURRENCIES: Record<string, string> = {
  india: 'Indian Rupee (INR, ₹)', usa: 'US Dollar (USD, $)', uk: 'British Pound (GBP, £)',
  japan: 'Japanese Yen (JPY, ¥)', china: 'Chinese Yuan (CNY, ¥)', germany: 'Euro (EUR, €)',
  france: 'Euro (EUR, €)', italy: 'Euro (EUR, €)', brazil: 'Brazilian Real (BRL, R$)',
  canada: 'Canadian Dollar (CAD, C$)', australia: 'Australian Dollar (AUD, A$)',
  russia: 'Russian Ruble (RUB, ₽)', 'south korea': 'South Korean Won (KRW, ₩)',
  uae: 'UAE Dirham (AED, د.إ)', 'saudi arabia': 'Saudi Riyal (SAR, ﷼)',
  singapore: 'Singapore Dollar (SGD, S$)', thailand: 'Thai Baht (THB, ฿)',
  mexico: 'Mexican Peso (MXN, $)', turkey: 'Turkish Lira (TRY, ₺)',
};

const POPULATIONS: Record<string, string> = {
  india: '1.44 billion (2024 estimate, most populous country in the world)',
  china: '1.42 billion', usa: '335 million', indonesia: '278 million',
  pakistan: '240 million', brazil: '216 million', nigeria: '225 million',
  bangladesh: '173 million', russia: '144 million', japan: '124 million',
  mexico: '130 million', germany: '84 million', uk: '67 million',
  france: '68 million', italy: '59 million', 'south korea': '52 million',
  australia: '26 million', canada: '40 million', 'saudi arabia': '36 million',
};

const PM_MINISTERS: Record<string, string> = {
  india: 'Narendra Modi', usa: 'The President is the head of state and government (currently Joe Biden, term ends Jan 2025)',
  uk: 'Keir Starmer (Prime Minister), King Charles III (Head of State)',
  japan: 'Shigeru Ishiba', germany: 'Olaf Scholz (Chancellor)',
  france: 'Emmanuel Macron', canada: 'Mark Carney',
  australia: 'Anthony Albanese', italy: 'Giorgia Meloni',
  russia: 'Mikhail Mishustin (PM), Vladimir Putin (President)',
  china: 'Li Qiang (Premier), Xi Jinping (President)',
  'south korea': 'Han Duck-soo (acting PM)', brazil: 'President Lula da Silva',
};

const GENERAL_KB: Record<string, string> = {
  'largest country by area': 'Russia is the largest country by area at approximately 17.1 million square kilometers, spanning Eastern Europe and Northern Asia.',
  'largest country by population': 'India is the most populous country in the world with approximately 1.44 billion people (2024), having surpassed China.',
  'smallest country': 'Vatican City is the smallest country in the world, with an area of just 0.44 square kilometers and a population of about 800.',
  'tallest mountain': 'Mount Everest is the tallest mountain on Earth, standing at 8,849 meters (29,032 feet) above sea level, located on the border of Nepal and China.',
  'longest river': 'The Nile River in Africa is generally considered the longest river in the world at approximately 6,650 kilometers (4,130 miles).',
  'largest ocean': 'The Pacific Ocean is the largest and deepest ocean, covering about 165.25 million square kilometers — more than Earth\'s total land area.',
  'sun': 'The Sun is a G-type main-sequence star (G2V) at the center of our solar system. Its surface temperature is about 5,500°C (9,932°F) and it is about 4.6 billion years old.',
  'moon': 'The Moon is Earth\'s only natural satellite, with a diameter of 3,474 km, about 384,400 km from Earth. It takes about 27.3 days to orbit Earth.',
  'earth': 'Earth is the third planet from the Sun and the only known planet to support life. It has a diameter of about 12,742 km, and is approximately 4.54 billion years old.',
  'speed of light': 'The speed of light in a vacuum is exactly 299,792,458 meters per second (approximately 300,000 km/s or 186,000 miles/s).',
  'pi': 'Pi (π) is approximately 3.14159265358979... It is the ratio of a circle\'s circumference to its diameter and is an irrational number with infinite non-repeating decimals.',
  'boiling point of water': 'Water boils at 100°C (212°F) at standard atmospheric pressure (1 atm). At higher altitudes, the boiling point decreases due to lower atmospheric pressure.',
  'freezing point of water': 'Water freezes at 0°C (32°F) at standard atmospheric pressure. Interestingly, water expands when it freezes, which is why ice floats.',
  'oxygen formula': 'The chemical formula for oxygen gas is O₂. It makes up about 21% of Earth\'s atmosphere by volume and is essential for most forms of life.',
  'photosynthesis': 'Photosynthesis is the process by which green plants, algae, and some bacteria convert sunlight, water, and carbon dioxide into glucose and oxygen. The chemical equation is: 6CO₂ + 6H₂O + light energy → C₆H₁₂O₆ + 6O₂.',
  'newton': 'Sir Isaac Newton (1643-1727) was an English mathematician, physicist, and astronomer. He formulated the laws of motion, discovered universal gravitation, and co-developed calculus. His three laws of motion form the foundation of classical mechanics.',
  'einstein': 'Albert Einstein (1879-1955) was a German-born theoretical physicist. He developed the theory of relativity (E=mc²), won the 1921 Nobel Prize in Physics for his explanation of the photoelectric effect, and is widely regarded as one of the most influential scientists in history.',
  'who invented': 'context needed — could you specify what you\'re asking about? For example, "who invented the telephone" (Alexander Graham Bell, 1876) or "who invented the internet" (Vint Cerf and Bob Kahn, TCP/IP protocol).',
  'light year': 'A light year is the distance that light travels in one Earth year, approximately 9.461 trillion kilometers (5.879 trillion miles). It is used to measure astronomical distances.',
  'dna': 'DNA (Deoxyribonucleic Acid) is the molecule that carries genetic instructions for the development and functioning of all living organisms. It was first identified by Friedrich Miescher in 1869, and its double-helix structure was discovered by Watson and Crick in 1953.',
  'periodic table': 'The periodic table organizes all 118 known chemical elements by atomic number, electron configuration, and chemical properties. It was first published by Dmitri Mendeleev in 1869.',
  'python programming': 'Python is a high-level, interpreted programming language created by Guido van Rossum and first released in 1991. It is known for its readable syntax, extensive standard library, and is widely used in web development, data science, AI/ML, and automation.',
  'javascript': 'JavaScript is a high-level, dynamic programming language created by Brendan Eich in 1995. It is essential for web development, running in every major browser, and is also used in server-side (Node.js), mobile (React Native), and desktop (Electron) applications.',
  'machine learning': 'Machine Learning is a subset of AI that enables systems to learn and improve from experience without being explicitly programmed. Key types include supervised learning, unsupervised learning, and reinforcement learning. Popular frameworks include TensorFlow, PyTorch, and scikit-learn.',
  'blockchain': 'Blockchain is a distributed, decentralized, immutable digital ledger technology. Each block contains a cryptographic hash of the previous block, creating a chain. It was conceptualized by Satoshi Nakamoto in 2008 as the foundation for Bitcoin.',
  'chatgpt': 'ChatGPT is an AI chatbot developed by OpenAI, first launched in November 2022. It is based on the GPT (Generative Pre-trained Transformer) family of large language models and can engage in conversational AI interactions, answer questions, and assist with various tasks.',
  'what is ai': 'Artificial Intelligence (AI) is the simulation of human intelligence by computer systems. It includes machine learning, natural language processing, computer vision, robotics, and more. Modern AI is primarily driven by deep learning and large language models.',
  'what is internet': 'The Internet is a global system of interconnected computer networks that communicate using standardized protocols (TCP/IP). It was developed from ARPANET (created in 1969 by the US Department of Defense) and became widely available in the 1990s with the World Wide Web.',
  'what is cloud computing': 'Cloud computing is the on-demand delivery of computing services — including servers, storage, databases, networking, software, and analytics — over the internet. Major providers include AWS, Microsoft Azure, and Google Cloud.',
  'solar system': 'Our solar system consists of the Sun and 8 planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune (plus dwarf planets like Pluto). It formed about 4.6 billion years ago from a giant molecular cloud.',
  'why is sky blue': 'The sky appears blue due to Rayleigh scattering. Sunlight enters Earth\'s atmosphere and collides with gas molecules. Shorter wavelengths (blue/violet) scatter more than longer wavelengths (red/orange). Our eyes are more sensitive to blue than violet, so we see a blue sky.',
  'how many planets': 'There are 8 planets in our solar system: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune. Pluto was reclassified as a dwarf planet in 2006 by the International Astronomical Union.',
  'how many continents': 'There are 7 continents on Earth: Asia, Africa, North America, South America, Antarctica, Europe, and Australia (Oceania).',
  'how many oceans': 'There are 5 oceans: Pacific, Atlantic, Indian, Southern (Antarctic), and Arctic.',
  'what is cricket': 'Cricket is a bat-and-ball sport played between two teams of 11 players. It originated in England and is hugely popular in India, Australia, England, Pakistan, and the West Indies. Formats include Test cricket, One Day Internationals (ODI), and Twenty20 (T20). The ICC is the global governing body.',
  'what is football': 'Football (soccer) is the world\'s most popular sport, played by two teams of 11 players on a rectangular field. The objective is to score goals by getting a ball into the opposing team\'s net. FIFA is the international governing body, and the FIFA World Cup is the most-watched sporting event globally.',
  'what is stock market': 'A stock market is a platform where shares of publicly traded companies are bought and sold. Major stock exchanges include the NYSE, NASDAQ (USA), London Stock Exchange (UK), BSE/NSE (India), and Tokyo Stock Exchange (Japan). Stock prices fluctuate based on company performance, economic conditions, and investor sentiment.',
  'what is inflation': 'Inflation is the rate at which the general price of goods and services rises over time, eroding purchasing power. It is typically measured by the Consumer Price Index (CPI). Central banks (like the RBI in India or the Federal Reserve in the US) target a low, stable inflation rate, usually around 2%. India\'s current inflation rate is approximately 4-5%.',
  'what is gdp': 'GDP (Gross Domestic Product) is the total monetary value of all goods and services produced within a country\'s borders in a specific time period. India\'s GDP is approximately $3.7 trillion (nominal, 2024), making it the 5th largest economy. GDP per capita of India is about $2,600.',
  'what is startup': 'A startup is a newly established business venture, typically characterized by innovation, rapid growth potential, and often technology-focused. In India, startups are recognized by the DPIIT and can get tax benefits under Section 80-IAC. India has the 3rd largest startup ecosystem globally with over 100,000+ recognized startups.',
  'india gdp': 'India\'s GDP is approximately $3.7 trillion (nominal, 2024), making it the 5th largest economy in the world. GDP growth rate is approximately 6.5-7%. India\'s GDP per capita is about $2,600. Key sectors: Services (54%), Industry (26%), Agriculture (20%).',
  'india population': 'India has a population of approximately 1.44 billion people (2024 estimate), making it the most populous country in the world, having surpassed China. India\'s median age is about 28 years, making it one of the youngest large populations globally.',
  'what is supabase': 'Supabase is an open-source alternative to Firebase, providing a PostgreSQL database, authentication, real-time subscriptions, storage, and edge functions. It is built on top of PostgreSQL and provides a RESTful API and real-time WebSocket connections. It is commonly used with Next.js, React, and other modern frameworks.',
  'what is next.js': 'Next.js is a React framework for building full-stack web applications. It features server-side rendering (SSR), static site generation (SSG), API routes, file-based routing, and is developed by Vercel. The current version is Next.js 15+, which includes the App Router, Server Components, and Turbopack support.',
  'what is react': 'React is a JavaScript library for building user interfaces, developed by Meta (Facebook). It uses a component-based architecture and a virtual DOM for efficient rendering. React 19 is the latest version, supporting Server Components, Actions, and concurrent features.',
  'what is typescript': 'TypeScript is a statically-typed superset of JavaScript developed by Microsoft. It adds optional type annotations, interfaces, generics, and other features that improve code quality and developer experience. It compiles to plain JavaScript and is widely adopted in large-scale applications.',
  'what is api': 'An API (Application Programming Interface) is a set of rules that allows different software applications to communicate with each other. Common types include REST APIs, GraphQL, and gRPC. APIs enable developers to access data and functionality from other services without needing to know their internal implementation.',
  'what is database': 'A database is an organized collection of structured data stored electronically. Types include relational databases (PostgreSQL, MySQL) using SQL, NoSQL databases (MongoDB, Redis), and cloud databases. Databases are essential for applications to store, retrieve, and manage data efficiently.',
  'what is html': 'HTML (HyperText Markup Language) is the standard language for creating web pages. It defines the structure and content of a webpage using elements like headings, paragraphs, links, images, and forms. The current version is HTML5, which includes semantic elements, multimedia support, and APIs.',
  'what is css': 'CSS (Cascading Style Sheets) is used to describe the presentation and styling of HTML documents. It controls layout, colors, fonts, spacing, and responsiveness. Modern CSS includes features like Flexbox, Grid, Custom Properties (variables), and animations. CSS frameworks like Tailwind CSS provide utility-first approaches.',
  'what is python': 'Python is a high-level, interpreted programming language known for its clean, readable syntax. Created by Guido van Rossum and first released in 1991, it is widely used in web development (Django, Flask), data science (pandas, NumPy), AI/ML (TensorFlow, PyTorch), automation, and scientific computing.',
  'what is java': 'Java is a class-based, object-oriented programming language developed by Sun Microsystems (now owned by Oracle) in 1995. It follows the "write once, run anywhere" principle through the Java Virtual Machine (JVM). It is widely used in enterprise applications, Android development, and large-scale systems.',
  'what is linux': 'Linux is a family of open-source Unix-like operating systems based on the Linux kernel, created by Linus Torvalds in 1991. Popular distributions include Ubuntu, Fedora, Debian, and Arch Linux. Linux powers most servers, supercomputers, and is the foundation for Android.',
  'what is git': 'Git is a distributed version control system created by Linus Torvalds in 2005 for tracking changes in source code during software development. Key concepts include repositories, commits, branches, merging, and pull requests. GitHub, GitLab, and Bitbucket are popular Git hosting platforms.',
};

// ─── DISABLED (2026-07-05): scripted-answer fallback ───
// This function is no longer called anywhere. It served hardcoded canned
// answers — including FABRICATED business stats presented as real data
// ("franchisees average 28% ROI", "franchise success rate ~90% vs ~10%") and
// references to non-existent brands ("QuickShelf", "BrandBooster"). Because
// brain-engine's RLS bug (fixed 2026-07-05) made every real call fail, this
// fallback answered EVERY message in the AI Brain tab. Failures now surface
// honestly in sendMessage. Kept temporarily for reference; safe to delete.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getSmartResponse(msg: string): string {
  const m = msg.toLowerCase().trim();

  // ─── Greetings ───
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|howdy|greetings|namaste|sup|yo)\b/i.test(m)) {
    return `Hello! I'm your FKAIOS Brain assistant — your central AI intelligence.\n\nI have access to:\n• **CRM Data** — Leads, pipeline, revenue analytics\n• **25+ AI Agents** — Sales, operations, intelligence agents\n• **6 Franchise Brands** — Franchisee Kart, QuickShelf, BrandBooster, and more\n• **Knowledge Vault** — Business documents and insights\n\nI can also answer general knowledge questions — geography, science, technology, history, and more.\n\nAsk me anything!`;
  }

  // ─── Capitals ───
  if (m.includes('capital of')) {
    for (const [country, capital] of Object.entries(CAPITALS)) {
      if (m.includes(country)) return `The capital of ${country.charAt(0).toUpperCase() + country.slice(1)} is **${capital}**.`;
    }
    const match = m.match(/capital of (.+)/i);
    if (match) return `I don't have the capital of "${match[1].trim()}" in my local knowledge base. For the most accurate answer, you can connect an AI API key in Settings for full LLM-powered responses.`;
  }

  // ─── Currency ───
  if (m.includes('currency of') || m.includes('what currency') || (m.includes('currency') && m.includes('does'))) {
    for (const [country, currency] of Object.entries(CURRENCIES)) {
      if (m.includes(country)) return `The currency of ${country.charAt(0).toUpperCase() + country.slice(1)} is the **${currency}**.`;
    }
  }

  // ─── Population ───
  if (m.includes('population of') || (m.includes('population') && m.includes('what'))) {
    for (const [place, pop] of Object.entries(POPULATIONS)) {
      if (m.includes(place)) return `The population of ${place.charAt(0).toUpperCase() + place.slice(1)} is approximately **${pop}**.`;
    }
  }

  // ─── PM/Leaders ───
  if (m.includes('prime minister of') || m.includes('president of') || m.includes('leader of') || m.includes('who is the pm') || m.includes('who is the president')) {
    for (const [country, leader] of Object.entries(PM_MINISTERS)) {
      if (m.includes(country)) return `The leader of ${country.charAt(0).toUpperCase() + country.slice(1)} is **${leader}**.`;
    }
  }

  // ─── Math ───
  if (/^[\d\s\+\-\*\/\(\)\.\^%]+$/.test(m) || m.match(/calculate|what is \d|compute|solve/i)) {
    try {
      const expr = m.replace(/[^0-9\+\-\*\/\(\)\.\s]/g, '').trim();
      if (expr) {
        const result = Function('"use strict"; return (' + expr + ')')();
        if (typeof result === 'number' && isFinite(result)) return `The answer is **${result}**.`;
      }
    } catch {}
  }

  // ─── Date/Time ───
  if (m.includes('what time') || m.includes('current time') || m.includes('what date') || m.includes('today\'s date') || m.includes('what day')) {
    const now = new Date();
    return `Current date and time: **${now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}**, ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} IST (India Standard Time).`;
  }

  // ─── General Knowledge ───
  for (const [key, answer] of Object.entries(GENERAL_KB)) {
    const words = key.split(' ');
    if (words.length <= 4 && words.every(w => m.includes(w))) return answer;
    if (m.includes(key)) return answer;
  }

  // ─── "What is X" catch-all for common topics ───
  if (m.startsWith('what is ') || m.startsWith('what are ') || m.startsWith('define ')) {
    const topic = m.replace(/^(what is |what are |define )/, '').trim();
    const topicAnswers: Record<string, string> = {
      'franchise': 'A franchise is a business model where a franchisor grants a franchisee the right to operate a business using its brand, systems, and support, in exchange for fees and royalties. In India, the franchise market is growing rapidly, estimated at $50+ billion, with sectors like food, retail, education, and services leading growth.',
      'crm': 'CRM (Customer Relationship Management) is a strategy and technology for managing all interactions with current and potential customers. In FKAIOS, the CRM tracks leads through stages (New → Qualified → Proposal → Negotiation → Won/Lost), scores them automatically, and uses AI agents for follow-ups and conversions.',
      'saas': 'SaaS (Software as a Service) is a cloud computing model where software is hosted centrally and accessed via the internet on a subscription basis. FKAIOS itself is a SaaS platform for franchise management. Benefits include lower upfront costs, automatic updates, and scalability.',
      'roi': 'ROI (Return on Investment) is a financial metric measuring profitability: (Net Profit / Investment Cost) × 100%. For franchise investments, a good ROI is typically 20-40% within 2-3 years. Franchisee Kart franchisees average 28% ROI in the first 18 months based on current data.',
      'marketing': 'Marketing is the process of promoting and selling products/services through market research, advertising, and distribution. For franchises, marketing includes brand-building at the national level (franchisor) and local marketing (franchisee). BrandBooster, one of our brands, is specifically a marketing franchise.',
      'entrepreneurship': 'Entrepreneurship is the process of creating, developing, and running a new business. Key traits include risk-taking, innovation, and problem-solving. Franchising is a popular form of entrepreneurship because it provides a proven business model with lower risk compared to starting from scratch.',
      'nft': 'An NFT (Non-Fungible Token) is a unique digital asset verified using blockchain technology. Each NFT has a distinct value and cannot be exchanged on a one-to-one basis. They are commonly used for digital art, collectibles, and gaming items.',
      'cryptocurrency': 'Cryptocurrency is a digital or virtual currency secured by cryptography, operating on decentralized blockchain networks. Bitcoin (created in 2009 by Satoshi Nakamoto) was the first. Other major ones include Ethereum, Solana, and Cardano. India taxes crypto at 30% plus 1% TDS on transactions.',
      'climate change': 'Climate change refers to long-term shifts in global temperatures and weather patterns, primarily driven by human activities like burning fossil fuels. Global average temperature has risen about 1.1°C above pre-industrial levels. The Paris Agreement aims to limit warming to 1.5°C. India is the 3rd largest emitter but has one of the lowest per-capita emissions.',
    };
    for (const [k, v] of Object.entries(topicAnswers)) {
      if (topic.includes(k) || k.includes(topic)) return v;
    }
  }

  // ─── "How to" / "How do" ───
  if (m.startsWith('how to ') || m.startsWith('how do ') || m.startsWith('how can ')) {
    const howAnswers: Record<string, string> = {
      'start a franchise': 'To start a franchise: 1) Research brands that fit your budget and interests, 2) Submit an enquiry through platforms like Franchisee Kart, 3) Attend a discovery meeting, 4) Review the FDD (Franchise Disclosure Document), 5) Secure funding, 6) Sign the franchise agreement, 7) Complete training, 8) Set up your location. Investment ranges from ₹5L to ₹50L depending on the brand.',
      'improve sales': 'To improve franchise sales: 1) Use the Sales Executive AI in AURA Blueprint for personalized client outreach, 2) Focus on leads scoring 70+ first, 3) Deploy the Follow-up Scheduler agent for automated nurturing, 4) Use objection handling playbooks for common concerns, 5) Monitor pipeline daily via the Dashboard, 6) Analyze source performance to double down on high-converting channels.',
      'score leads': 'FKAIOS uses AI-powered lead scoring based on BANT criteria (Budget, Authority, Need, Timeline). Scores range from 0-100. Leads scoring 80+ are hot, 60-79 are warm, below 60 are cold. Use AURA Blueprint → Lead Scoring tab to view and re-score leads. The AI considers engagement level, brand fit, investment capacity, and geographic match.',
      'use aura blueprint': 'AURA Blueprint is in the AI Brain System section of the sidebar. It has 6 tabs: 1) Overview for KPIs and pipeline funnel, 2) Sales Agents to manage AI agents, 3) Lead Scoring for score analysis, 4) AI Tools for 6 executable tools like Lead Qualifier and Deal Optimizer, 5) Analytics for brand and source performance, 6) Sales Executive AI for human-like client conversations.',
    };
    for (const [k, v] of Object.entries(howAnswers)) {
      if (m.includes(k)) return v;
    }
  }

  // ─── Comparisons ───
  if (m.includes(' vs ') || m.includes('difference between') || m.includes('compare')) {
    const compAnswers: Record<string, string> = {
      'franchisee kart vs quickshelf': '**Franchisee Kart** (₹10-50L) is a multi-brand franchise platform for established entrepreneurs wanting a portfolio of brands. **QuickShelf** (₹8-25L) is a Q-Commerce retail franchise focused on quick delivery and retail operations. Franchisee Kart has higher revenue potential; QuickShelf has lower entry cost and faster setup.',
      'franchise vs startup': '**Franchise**: Proven business model, brand recognition, training & support, lower risk. Cons: Less creative control, royalty fees. **Startup**: Full creative control, potential for higher returns, scalable. Cons: Higher risk, no established brand, longer time to profitability. Franchise success rate is ~90% vs ~10% for startups.',
    };
    for (const [k, v] of Object.entries(compAnswers)) {
      if (m.includes(k)) return v;
    }
    return `I can help with comparisons! For FKAIO-specific comparisons, I can compare brands (e.g., "Franchisee Kart vs QuickShelf") or business models (e.g., "franchise vs startup"). For other topics, try connecting an AI API key in Settings for broader knowledge.`;
  }

  // ─── Yes/No questions ───
  if (m.startsWith('is ') || m.startsWith('are ') || m.startsWith('do ') || m.startsWith('does ') || m.startsWith('can ') || m.startsWith('will ')) {
    const ynAnswers: Record<string, string> = {
      'india a democracy': 'Yes, India is the world\'s largest democracy with a parliamentary system of government. It has a multi-party system with elections conducted by the Election Commission of India. India\'s democracy has been functioning since independence in 1947.',
      'earth round': 'Yes, the Earth is roughly spherical (an oblate spheroid to be precise). It has a slightly flattened shape at the poles and a slight bulge at the equator. The Earth\'s circumference at the equator is about 40,075 km.',
      'light faster than sound': 'Yes, light is significantly faster than sound. Light travels at approximately 300,000 km/s, while sound travels at about 343 m/s in air at room temperature. This is why you see lightning before hearing thunder.',
      'pluto a planet': 'Pluto was reclassified from a planet to a dwarf planet in 2006 by the International Astronomical Union (IAU). The reason is that Pluto did not "clear its neighborhood" — it shares its orbital zone with other Kuiper Belt objects.',
      'ai dangerous': 'AI, like any powerful technology, has both benefits and risks. Current AI systems (including FKAIOS) are narrow/specialized AI focused on specific tasks. Key concerns include job displacement, bias in decision-making, privacy, and potential misuse. However, AI also enables significant benefits in healthcare, education, business efficiency, and scientific research. The key is responsible development and regulation.',
    };
    for (const [k, v] of Object.entries(ynAnswers)) {
      if (m.includes(k)) return v;
    }
  }

  // ─── FKAIO Business: Pipeline ───
  if (m.includes('pipeline') || m.includes('leads') || (m.includes('analyze') && m.includes('lead')) || m.includes('how many leads')) {
    return `Here's your current pipeline analysis:\n\n**Pipeline Overview:**\n• Total Leads: 10\n• Active Leads: 8 (excluding won/lost)\n• Total Pipeline Value: ₹21.0L\n• Average Lead Score: 72/100\n• Conversion Rate: 10%\n\n**Stage Breakdown:**\n• New: 2 leads — ₹3.1L\n• Qualified: 2 leads — ₹6.0L\n• Proposal: 2 leads — ₹3.3L\n• Negotiation: 2 leads — ₹4.1L\n• Won: 1 lead — ₹42.0L\n• Lost: 1 lead — ₹38.0L\n\n**Top 3 Leads by Score:**\n1. Vikram Singh — 96/100 — ₹42.0L (Won!)\n2. Rajesh Kumar — 92/100 — ₹25.0L (Qualified)\n3. Meera Joshi — 88/100 — ₹29.0L (Negotiation)\n\n**Recommendation:** Focus on Rajesh Kumar and Meera Joshi — both high scores in active stages. Use the Sales Executive AI for personalized conversations.`;
  }

  // ─── FKAIO Business: Revenue ───
  if (m.includes('revenue') || m.includes('income') || m.includes('money') || (m.includes('report') && m.includes('brand'))) {
    return `**Revenue Report — All Brands:**\n\n| Brand | Pipeline | Won Revenue | Total Leads |\n|-------|----------|-------------|-------------|\n| Franchisee Kart | ₹6.0L | ₹42.0L | 4 |\n| QuickShelf | ₹5.5L | ₹0L | 3 |\n| BrandBooster | ₹2.1L | ₹0L | 3 |\n\n**Key Metrics:**\n• Total Won Revenue: ₹42.0L (Vikram Singh — Franchisee Kart)\n• Open Pipeline: ₹21.0L across 8 active leads\n• Average Deal Size: ₹26.3L\n\n**Insight:** Franchisee Kart leads with the only closed deal. QuickShelf and BrandBooster need attention — deploy the Sales Executive AI on their warm leads scoring 70+.`;
  }

  // ─── FKAIO Business: Agents ───
  if (m.includes('agent') || m.includes('factory')) {
    return `**Active AI Agents — Agent Factory:**\n\n1. **Lead Qualifier** (Active) — 89% success, 147 tasks\n2. **Objection Handler** (Active) — 82% success, 98 tasks\n3. **Pipeline Predictor** (Active) — 91% success, 64 tasks\n4. **Follow-up Scheduler** (Paused) — 95% success, 210 tasks\n5. **Competitive Intel** (Active) — 78% success, 35 tasks\n6. **Revenue Optimizer** (Active) — 86% success, 52 tasks\n\nVisit **Agent Factory** in the sidebar to manage these agents.`;
  }

  // ─── FKAIO Business: Franchise / Strategy ───
  if (m.includes('franchise') || m.includes('expansion') || m.includes('strategy') || m.includes('grow')) {
    return `**Franchise Expansion Strategy — Q3 2026:**\n\n**Brand Portfolio:**\n• Franchisee Kart — Multi-brand platform (₹10-50L)\n• QuickShelf — Q-Commerce retail (₹8-25L)\n• BrandBooster — Marketing franchise (₹5-20L)\n\n**Recommendations:**\n1. **Territory Expansion** — Focus on Tier 2 cities (Jaipur, Chandigarh, Indore, Coimbatore) where franchise demand is growing 35% YoY.\n2. **QuickShelf & BrandBooster** — Deploy Sales Executive AI on leads scoring 70+ to get first wins.\n3. **Pipeline Push** — 2 leads in negotiation (₹4.1L) could close within 30 days.\n4. **Activate Follow-up Scheduler** — Currently paused; could boost conversion by 15-20%.`;
  }

  // ─── FKAIO: Decision / Knowledge / Learning / AURA ───
  if (m.includes('decision') || m.includes('help me decide') || m.includes('should i')) {
    return `I can help with decisions using a 6-dimension framework:\n1. **Impact** — How significant is the outcome?\n2. **Feasibility** — Can it be executed with current resources?\n3. **Risk** — What are the downside scenarios?\n4. **Cost** — Financial investment required\n5. **Timeline** — How quickly can it be implemented?\n6. **Alignment** — Does it fit the overall business strategy?\n\nUse the **Decision Engine** page for multi-dimensional scoring. Tell me the specific decision you're facing!`;
  }
  if (m.includes('knowledge') || m.includes('vault') || m.includes('document')) {
    return `**Knowledge Vault** is your centralized document repository with AI-powered search. Visit it in the AI Brain System sidebar to upload, browse, and manage business documents. The vault feeds context to all AI agents.`;
  }
  if (m.includes('learn') || m.includes('insight') || m.includes('improve') || m.includes('optimi')) {
    return `**Self-Learning Module** captures patterns and insights from your operations — recurring trends, process improvements, feedback analysis, and strategic insights. Visit **Self-Learning** in the sidebar.`;
  }
  if (m.includes('aura') || m.includes('blueprint')) {
    return `**AURA Blueprint** (Autonomous Unified Revenue Architecture) — 6 tabs:\n1. Overview — KPIs, pipeline funnel, agent health\n2. Sales Agents — Toggle 6 AI agents on/off\n3. Lead Scoring — Score distribution, sortable list\n4. AI Tools — 6 tools: Qualifier, Objection Handler, Forecast, Follow-up, Intel, Deal Optimizer\n5. Analytics — Revenue, source, agent comparison\n6. Sales Executive AI — Human-like client conversations with 3 tones\n\nNavigate to **AI Brain System → AURA Blueprint**.`;
  }

  // ─── What can you do / Who are you ───
  if (m.includes('what can you') || m.includes('what do you')) {
    return `I'm the FKAIOS Brain — I can help with:\n\n**Business Intelligence:** Pipeline analysis, revenue reports, franchise strategies\n**AI Agents:** Monitor and control 25+ agents\n**General Knowledge:** Geography, science, technology, history, math, current affairs\n**Tools:** AURA Blueprint, Sales Executive AI, Agent Factory, Decision Engine\n\nTry asking me about anything — capitals, science, tech, or your business data!`;
  }
  if (m.includes('who are you') || m.includes('what are you')) {
    return "I'm the FKAIOS Brain — the central AI intelligence for Franchisee Kart AIOS. I provide business intelligence, CRM analytics, AI agent management, and general knowledge answers. I have access to your leads pipeline, 25+ AI agents, knowledge vault, and 6 franchise brands. I can also answer general knowledge questions about geography, science, technology, and more.";
  }

  // ─── Thank you / goodbye ───
  if (/^(thanks|thank you|thx|ty|bye|goodbye|see you)/i.test(m)) {
    return m.match(/bye|goodbye|see you/i)
      ? "Goodbye! I'll be here whenever you need me. Have a productive day!"
      : "You're welcome! Let me know if you need anything else.";
  }

  // ─── Jokes / fun ───
  if (m.includes('joke') || m.includes('funny') || m.includes('make me laugh')) {
    const jokes = [
      "Why do franchises make great comedians? Because they always follow a proven format!",
      "A franchisee walks into a bar... and finds out it's already a chain with 500 locations.",
      "Why did the AI agent cross the road? To optimize the lead conversion rate on the other side.",
    ];
    return jokes[Math.floor(Math.random() * jokes.length)];
  }

  // ─── Intelligent fallback with keyword matching ───
  const keywordResponses: [string[], string][] = [
    [['weather'], 'I don\'t have real-time weather data access. For weather information, check a weather service like IMD (India Meteorological Department) or use a weather app.'],
    [['news'], 'I don\'t have real-time news access. For the latest news, check a news website or app. I can help with business data and general knowledge questions!'],
    [['translate'], 'I can help with basic translations! Please specify the phrase and target language. For professional translations, I recommend using a dedicated translation service.'],
    [['email'], 'I can help draft emails! Tell me the context (e.g., "draft an email to a franchise lead about a meeting") and I\'ll create a professional draft.'],
    [['meeting'], 'To schedule a meeting, use the **Meetings** page in the Operations section. You can track meeting status, add notes, and set follow-up reminders.'],
    [['invoice'], 'For invoice management, use the **Invoices** page in the Operations sidebar. You can create, send, and track payment collection.'],
    [['brand'], 'You have 3 active brands:\n• **Franchisee Kart** — Multi-brand platform (₹10-50L)\n• **QuickShelf** — Q-Commerce retail (₹8-25L)\n• **BrandBooster** — Marketing franchise (₹5-20L)\n\nVisit **Brand Management** in Operations for details.'],
    [['team', 'member', 'consultant'], 'Visit the **Team** page in Operations to manage team members, roles, and performance. Currently your team structure and consultant profiles are managed there.'],
    [['setting', 'config', 'api key'], 'Visit **Settings** in the Operations sidebar to configure API keys, integrations, branding, and system preferences.'],
    [['notif'], 'Visit **Notifications** in Operations to see real-time updates on lead activity, AI task completions, and system alerts.'],
    [['calendar', 'schedule'], 'Visit **Calendar** in Operations to see all meetings, follow-ups, deadlines, and brand events in a calendar view.'],
    [['workflow', 'automat'], 'Visit **Workflows** in Operations to create and manage trigger-based automation workflows for your AI agents.'],
    [['executive', 'milestone', 'founder'], 'Visit **Executive AI** in Operations for strategic milestones, founder memory, and business intelligence from the executive perspective.'],
  ];
  for (const [keywords, response] of keywordResponses) {
    if (keywords.some(k => m.includes(k))) return response;
  }

  // ─── Final smart fallback ───
  return `I understand your question: "${msg.substring(0, 120)}"\n\nI can provide detailed analysis on:\n• **Business Data** — Pipeline, revenue, leads, agents\n• **General Knowledge** — Geography, science, technology, math\n• **How-to Guides** — "How to improve sales", "How to use AURA Blueprint"\n• **Comparisons** — "Franchisee Kart vs QuickShelf"\n\nTry rephrasing your question or ask me something specific about your business!`;
}

export default function BrainChat() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const refreshConvList = () => {
    supabase.functions.invoke('brain-engine', { body: { action: 'list' } }).then(({ data }) => {
      if (data) setConversations(Array.isArray(data) ? data : []);
    }).catch(() => {});
  };

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    const ac = new AbortController();
    const fetch = async () => {
      try {
        const { data } = await supabase.functions.invoke('brain-engine', { body: { action: 'list' } }, { signal: ac.signal as any });
        if (data && !ac.signal.aborted) setConversations(Array.isArray(data) ? data : []);
      } catch { /* ignore */ }
    };
    fetch();
    return () => ac.abort();
  }, []);

  const createChat = async () => {
    try {
      const { data } = await supabase.functions.invoke('brain-engine', { body: { action: 'create' } });
      if (data) { setActiveConvId(data.id); setMessages([]); refreshConvList(); }
    } catch (e) {
      // Fallback: create local conversation
      const fakeId = 'local-' + Date.now();
      setActiveConvId(fakeId);
      setMessages([]);
      setConversations(prev => [{ id: fakeId, title: 'New Conversation' }, ...prev]);
    }
  };

  const selectConv = async (id: string) => {
    setActiveConvId(id);
    try {
      const { data } = await supabase.functions.invoke('brain-engine', { body: { action: 'list' } });
      const conv = (data || []).find((c: any) => c.id === id);
      setMessages(conv?.messages || []);
    } catch { setMessages([]); }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    let convId = activeConvId;
    if (!convId) {
      const fakeId = 'local-' + Date.now();
      convId = fakeId;
      setActiveConvId(convId);
      setConversations(prev => [{ id: fakeId, title: input.trim().substring(0, 40) }, ...prev]);
    }
    const userMsg = input.trim();
    setInput('');
    setLoading(true);
    setMessages(prev => [...prev, { role: 'user', content: userMsg, created_at: new Date().toISOString() }]);

    // Real brain-engine call only — no scripted fallback.
    // HONESTY FIX (2026-07-05): previously, any failure here fell through to
    // getSmartResponse(), a ~200-line bank of scripted answers with fabricated
    // stats (e.g. invented ROI figures and non-existent brands). Because
    // brain-engine had an RLS bug until 2026-07-05, that fallback was firing on
    // EVERY message — the AI Brain tab was serving 100% scripted responses
    // while appearing to work. Failures now say so plainly instead.
    let reply = null;
    let failureDetail = '';
    try {
      const { data, error } = await supabase.functions.invoke('brain-engine', { body: { action: 'message', conversationId: convId, message: userMsg } });
      if (error) failureDetail = error.message || 'edge function returned an error';
      if (data?.message) reply = data.message;
      else if (data?.content) reply = { role: 'assistant', content: data.content, created_at: new Date().toISOString() };
      else if (data?.error) failureDetail = data.error;
      refreshConvList();
    } catch (e) { failureDetail = e instanceof Error ? e.message : 'edge function unavailable'; }

    if (!reply) {
      reply = { role: 'assistant', content: `⚠ Brain engine call failed${failureDetail ? `: ${failureDetail}` : ''}. No answer was generated — this is a real error, not a canned response. Please retry; if it persists, check brain-engine logs in Supabase.`, created_at: new Date().toISOString() };
    }

    setMessages(prev => [...prev, reply]);
    setLoading(false);
  };

  const quickActions = ['Analyze my leads pipeline', 'Revenue report across brands', 'What agents are available?', 'Franchise expansion strategy', 'What is AURA Blueprint?', 'What can you do?'];

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <div className="w-56 shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-white">Conversations</h2>
        </div>
        <button onClick={createChat} className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors cursor-pointer">+ New Chat</button>
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {conversations.map((c: any) => (
            <button key={c.id} onClick={() => selectConv(c.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer ${c.id === activeConvId ? 'bg-blue-600/20 text-blue-400' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}`}>
              <span className="truncate block">{c.title || 'New Conversation'}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">B</span>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">FKAIOS Brain</h2>
            <p className="text-[10px] text-slate-500">Central AI Intelligence</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center"><span className="text-2xl text-purple-400 font-bold">AI</span></div>
              <div className="text-center">
                <h3 className="text-lg font-semibold text-white">FKAIOS Brain</h3>
                <p className="text-sm text-slate-400 mt-1">Your central AI intelligence with access to CRM, Knowledge Vault, and 25+ agents.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full max-w-md mt-2">
                {quickActions.map(qa => (
                  <button key={qa} onClick={() => { setInput(qa); }}
                    className="text-left px-3 py-2.5 rounded-lg border border-slate-700 hover:border-blue-500/30 hover:bg-slate-800/50 transition-all text-xs text-slate-300 cursor-pointer">{qa}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-xl px-4 py-3 ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-200'}`}>
                    {m.role === 'assistant' && <p className="text-[10px] text-purple-400 mb-1">FKAIOS Brain</p>}
                    <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              ))}
              {loading && <div className="flex items-center gap-2 text-slate-400 text-xs"><span className="animate-spin">...</span> Thinking...</div>}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="p-3 border-t border-slate-800">
          <form onSubmit={e => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask FKAIOS Brain anything..."
              disabled={loading} className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
            <button type="submit" disabled={loading || !input.trim()} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer">Send</button>
          </form>
        </div>
      </div>
    </div>
  );
}