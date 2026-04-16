import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let weights;
try {
    const data = readFileSync(join(__dirname, '..', 'Weight.txt'), 'utf8');
    weights = JSON.parse(data);
} catch (err) {
    console.error('[!] Error loading Weight.txt:', err.message);
    process.exit(1);
}

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NUMBERS   = '0123456789';
const SPECIAL   = ".[];'?()*&^%$#@!";
const availableChars = LOWERCASE + UPPERCASE + NUMBERS + SPECIAL;

function weigrand(dis) {
    const threshold = Math.random();
    let sum = 0;
    for (const [key, value] of Object.entries(dis)) {
        sum += value;
        if (threshold <= sum) return key;
    }
    return null;
}

function getRandomSeed() {
    return availableChars[Math.floor(Math.random() * availableChars.length)];
}

function getRandomLength(min = 6, max = 16) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a single Markov-weighted password.
 * The seed character is chosen uniformly at random from the full character set.
 * Each subsequent character is sampled from the weight matrix conditioned on
 * the previous character — mimicking real password construction patterns.
 */
export function generateMarkovPassword(seed = null, length = null) {
    const finalSeed   = seed   || getRandomSeed();
    const finalLength = length || getRandomLength();
    let out = finalSeed;

    for (let i = 0; i < finalLength; i++) {
        const lastChar = out[out.length - 1];
        const dist     = weights[lastChar];
        if (!dist) break;
        const next = weigrand(dist);
        if (!next) break;
        out += next;
    }

    return out;
}

export { weights, availableChars };
