/*
 * Nudge - Pip MCU Sketch for Arduino UNO Q
 * 
 * Drives the 12x8 LED Matrix face, listens for physical Allow / Deny buttons,
 * detects pokes, and communicates with the Python agent via Arduino_RouterBridge.
 *
 * Moods: idle | peek | watching | needs_you | happy | annoyed | dizzy | asleep
 */

#include "Arduino_LED_Matrix.h"
#include "Arduino_RouterBridge.h"

// Hardware Pin Definitions
const int PIN_BTN_ALLOW = 2; // Green / Allow button (active LOW)
const int PIN_BTN_DENY  = 3; // Red / Deny button (active LOW)
const int PIN_BTN_POKE  = 4; // Capacitive / Poke button (active LOW)

ArduinoLEDMatrix matrix;

// Debounce timing (ms)
const unsigned long DEBOUNCE_MS = 50;
unsigned long lastAllowPressTime = 0;
unsigned long lastDenyPressTime  = 0;
unsigned long lastPokePressTime  = 0;

int lastAllowState = HIGH;
int lastDenyState  = HIGH;
int lastPokeState  = HIGH;

// Current Mood state
String currentMood = "idle";
unsigned long lastBlinkTime = 0;
unsigned long blinkInterval = 3500;
bool isBlinking = false;
unsigned long blinkStartTime = 0;

// Pulse timing for needs_you mood
unsigned long lastPulseTime = 0;
bool pulseState = false;

// 12x8 LED Matrix Bitmaps (8 rows x 12 columns)
// ArduinoLEDMatrix takes 3 uint32_t words representing 96 LEDs.
// We provide helper macros or raw bit arrays for crisp readable expressions.

// Frame definitions (3 uint32_t per frame)
const uint32_t FRAME_IDLE[3] = {
    0b000000000000001100001100, // Rows 0-1
    0b001100001100000000000000, // Rows 2-3
    0b010000000010001111111100  // Rows 4-5, 6-7 (Eyes + Smile)
};

const uint32_t FRAME_BLINK[3] = {
    0b000000000000000000000000,
    0b001111001111000000000000,
    0b010000000010001111111100
};

const uint32_t FRAME_PEEK[3] = {
    0b001100001100011110011110,
    0b010010010010000000000000,
    0b000000000000000111111000
};

const uint32_t FRAME_WATCHING[3] = {
    0b011110011110010010010010,
    0b010010010010011110011110,
    0b000000000000000111111000
};

const uint32_t FRAME_NEEDS_YOU_A[3] = {
    0b011100001110011100001110,
    0b011100001110000000000000,
    0b011100001110001111111100
};

const uint32_t FRAME_NEEDS_YOU_B[3] = {
    0b000000000000011100001110,
    0b011100001110000000000000,
    0b000000000000000000000000
};

const uint32_t FRAME_HAPPY[3] = {
    0b001100001100010010010010,
    0b010001010001000000000000,
    0b010000000010001111111100
};

const uint32_t FRAME_ANNOYED[3] = {
    0b000000000000011110011110,
    0b000010000010000000000000,
    0b000000000000001111111100
};

const uint32_t FRAME_DIZZY[3] = {
    0b010010010010001100001100,
    0b001100001100010010010010,
    0b000000000000001010101000
};

const uint32_t FRAME_ASLEEP[3] = {
    0b000000000011000000000110,
    0b001111001111000000001100,
    0b000000000000000011110000
};

// RPC callback invoked by Python on Linux MPU
void rpc_set_mood(String mood) {
    mood.trim();
    currentMood = mood;
    updateMoodMatrix();
}

void updateMoodMatrix() {
    if (currentMood == "idle") {
        matrix.loadFrame(FRAME_IDLE);
    } else if (currentMood == "peek") {
        matrix.loadFrame(FRAME_PEEK);
    } else if (currentMood == "watching") {
        matrix.loadFrame(FRAME_WATCHING);
    } else if (currentMood == "needs_you") {
        matrix.loadFrame(pulseState ? FRAME_NEEDS_YOU_A : FRAME_NEEDS_YOU_B);
    } else if (currentMood == "happy") {
        matrix.loadFrame(FRAME_HAPPY);
    } else if (currentMood == "annoyed") {
        matrix.loadFrame(FRAME_ANNOYED);
    } else if (currentMood == "dizzy") {
        matrix.loadFrame(FRAME_DIZZY);
    } else if (currentMood == "asleep") {
        matrix.loadFrame(FRAME_ASLEEP);
    } else {
        matrix.loadFrame(FRAME_IDLE);
    }
}

void setup() {
    Serial.begin(115200);

    // Initialize physical buttons with internal pull-ups
    pinMode(PIN_BTN_ALLOW, INPUT_PULLUP);
    pinMode(PIN_BTN_DENY,  INPUT_PULLUP);
    pinMode(PIN_BTN_POKE,  INPUT_PULLUP);

    // Start LED matrix
    matrix.begin();
    updateMoodMatrix();

    // Start Router Bridge to Linux MPU
    Bridge.begin();
    Bridge.provide("set_mood", rpc_set_mood);

    Serial.println("Pip MCU initialized. Ready for Nudge agent.");
}

void loop() {
    unsigned long now = millis();

    // 1. Check Allow Button
    int allowVal = digitalRead(PIN_BTN_ALLOW);
    if (allowVal != lastAllowState) {
        if (allowVal == LOW && (now - lastAllowPressTime) > DEBOUNCE_MS) {
            lastAllowPressTime = now;
            Serial.println("BTN: ALLOW pressed");
            Bridge.call("on_mcu_event", "{\"type\":\"button\",\"action\":\"allow\"}");
        }
        lastAllowState = allowVal;
    }

    // 2. Check Deny Button
    int denyVal = digitalRead(PIN_BTN_DENY);
    if (denyVal != lastDenyState) {
        if (denyVal == LOW && (now - lastDenyPressTime) > DEBOUNCE_MS) {
            lastDenyPressTime = now;
            Serial.println("BTN: DENY pressed");
            Bridge.call("on_mcu_event", "{\"type\":\"button\",\"action\":\"deny\"}");
        }
        lastDenyState = denyVal;
    }

    // 3. Check Poke Sensor / Button
    int pokeVal = digitalRead(PIN_BTN_POKE);
    if (pokeVal != lastPokeState) {
        if (pokeVal == LOW && (now - lastPokePressTime) > DEBOUNCE_MS) {
            lastPokePressTime = now;
            Serial.println("BTN: POKE triggered");
            Bridge.call("on_mcu_event", "{\"type\":\"poke\"}");
        }
        lastPokeState = pokeVal;
    }

    // 4. Handle Mood Animations (Blinking & Pulsing)
    if (currentMood == "idle") {
        if (!isBlinking && (now - lastBlinkTime > blinkInterval)) {
            isBlinking = true;
            blinkStartTime = now;
            matrix.loadFrame(FRAME_BLINK);
        } else if (isBlinking && (now - blinkStartTime > 180)) {
            isBlinking = false;
            lastBlinkTime = now;
            blinkInterval = random(2500, 5000);
            matrix.loadFrame(FRAME_IDLE);
        }
    } else if (currentMood == "needs_you") {
        if (now - lastPulseTime > 350) {
            lastPulseTime = now;
            pulseState = !pulseState;
            matrix.loadFrame(pulseState ? FRAME_NEEDS_YOU_A : FRAME_NEEDS_YOU_B);
        }
    }

    delay(10);
}
