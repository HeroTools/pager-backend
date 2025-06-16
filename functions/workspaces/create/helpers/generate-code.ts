import { randomInt } from 'crypto';

const ALPHANUMERIC = '0123456789abcdefghijklmnopqrstuvwxyz';

export function generateCode(length = 6): string {
    let code = '';
    for (let i = 0; i < length; i++) {
        // randomInt is inclusive of min, exclusive of max
        const idx = randomInt(0, ALPHANUMERIC.length);
        code += ALPHANUMERIC[idx];
    }
    return code;
}
