#include "MapStreamJsi.h"

#include "mapstream/map_stream_worker.h"

#include <memory>
#include <utility>
#include <vector>

namespace mapstream_jsi {
namespace {

using namespace facebook;

/**
 * Holds RGBA bytes alive until the JS ArrayBuffer wrapper is collected.
 * The ArrayBuffer ctor taking std::shared_ptr<jsi::MutableBuffer> shares ownership of this object.
 */
class SharedVectorMutableBuffer final : public jsi::MutableBuffer {
public:
  explicit SharedVectorMutableBuffer(std::shared_ptr<std::vector<uint8_t>> storage)
      : storage_(std::move(storage)) {}

  size_t size() const override {
    return storage_->size();
  }

  uint8_t *data() override {
    return storage_->data();
  }

private:
  std::shared_ptr<std::vector<uint8_t>> storage_;
};

} // namespace

jsi::Value decodedFrameToJs(jsi::Runtime &rt, std::shared_ptr<const mapstream::DecodedMapFrame> frame) {
  if (!frame || !frame->rgba || frame->rgba->empty()) {
    return jsi::Value::null();
  }

  jsi::Object o(rt);
  o.setProperty(rt, "metaJson", jsi::String::createFromUtf8(rt, frame->metaJsonUtf8));
  o.setProperty(rt, "width", frame->width);
  o.setProperty(rt, "height", frame->height);
  o.setProperty(rt, "sequence", jsi::Value(static_cast<double>(frame->sequence)));

  std::shared_ptr<jsi::MutableBuffer> backing =
      std::make_shared<SharedVectorMutableBuffer>(frame->rgba);
  jsi::ArrayBuffer ab(rt, std::move(backing));
  o.setProperty(rt, "rgba", std::move(ab));
  return o;
}

} // namespace mapstream_jsi
