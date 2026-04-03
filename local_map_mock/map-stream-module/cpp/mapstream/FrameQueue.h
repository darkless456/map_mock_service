#pragma once
/**
 * @file FrameQueue.h
 * @brief Lock-free single-producer / single-consumer frame exchange.
 *
 * Uses a triple-buffer (atomic swap) pattern:
 *   - Producer (MQTT decode thread) writes to the "back" slot.
 *   - Consumer (JS thread)          reads from the "front" slot.
 *   - A "ready" slot holds the latest committed frame.
 *
 * The producer publishes by swapping back↔ready (atomic).
 * The consumer acquires by swapping front↔ready (atomic).
 *
 * This guarantees:
 *   ✓ Zero mutex contention between producer and consumer
 *   ✓ Consumer always gets the *latest* decoded frame
 *   ✓ Producer never blocks waiting for consumer
 *   ✓ No data race (each slot accessed by only one thread at a time)
 *
 * Memory overhead: 3 × sizeof(shared_ptr<MapFragment>) — negligible.
 */

#include "MapTypes.h"
#include <atomic>
#include <memory>

namespace mapstream {

class FrameQueue {
 public:
  FrameQueue() {
    // All slots start as nullptr (no frame available)
    slots_[0] = nullptr;
    slots_[1] = nullptr;
    slots_[2] = nullptr;
    back_.store(0, std::memory_order_relaxed);
    ready_.store(1, std::memory_order_relaxed);
    front_.store(2, std::memory_order_relaxed);
    hasNew_.store(false, std::memory_order_relaxed);
  }

  /**
   * Producer: publish a new decoded frame.
   * Called from the MQTT/decode background thread.
   */
  void publish(std::shared_ptr<MapFragment> frame) {
    int backIdx = back_.load(std::memory_order_relaxed);
    slots_[backIdx] = std::move(frame);

    // Swap back ↔ ready
    int readyIdx = ready_.exchange(backIdx, std::memory_order_acq_rel);
    back_.store(readyIdx, std::memory_order_relaxed);
    hasNew_.store(true, std::memory_order_release);
  }

  /**
   * Consumer: acquire the latest frame (if any new one is available).
   * Called from the JS thread.
   *
   * @return Latest frame, or nullptr if no new frame since last acquire().
   */
  std::shared_ptr<MapFragment> acquire() {
    if (!hasNew_.load(std::memory_order_acquire)) {
      return nullptr;  // No new frame
    }
    hasNew_.store(false, std::memory_order_relaxed);

    // Swap front ↔ ready
    int frontIdx = front_.load(std::memory_order_relaxed);
    int readyIdx = ready_.exchange(frontIdx, std::memory_order_acq_rel);
    front_.store(readyIdx, std::memory_order_relaxed);

    return slots_[readyIdx];
  }

  /**
   * Reset all slots. Call only when both producer and consumer are idle.
   */
  void reset() {
    slots_[0] = nullptr;
    slots_[1] = nullptr;
    slots_[2] = nullptr;
    hasNew_.store(false, std::memory_order_relaxed);
  }

 private:
  std::shared_ptr<MapFragment> slots_[3];

  std::atomic<int>  back_{0};
  std::atomic<int>  ready_{1};
  std::atomic<int>  front_{2};
  std::atomic<bool> hasNew_{false};
};

} // namespace mapstream
