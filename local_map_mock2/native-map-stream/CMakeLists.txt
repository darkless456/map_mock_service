cmake_minimum_required(VERSION 3.16)
project(mapstream_worker LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(MAPSTREAM_WITH_PAHO "Link Eclipse Paho MQTTAsync (MQTTAsync C API)" OFF)

add_library(mapstream_worker STATIC
  src/map_stream_worker.cpp
  src/stub_mqtt_transport.cpp
  src/paho_mqtt_async_transport.cpp
  "${CMAKE_CURRENT_LIST_DIR}/../react-native-mvp/cpp/MapFrameParserCore.cpp"
)

target_include_directories(mapstream_worker
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/../react-native-mvp/cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../third_party"
)

if(MAPSTREAM_WITH_PAHO)
  target_compile_definitions(mapstream_worker PUBLIC MAPSTREAM_WITH_PAHO)
  # Integrators: add find_package / FetchContent for eclipse-paho-mqtt-c and link mqtt3as.
  # target_link_libraries(mapstream_worker PUBLIC PahoMqtt::paho-mqtt3as)
endif()

add_executable(mapstream_smoke_test
  tools/smoke_test.cpp
)
target_link_libraries(mapstream_smoke_test PRIVATE mapstream_worker)
