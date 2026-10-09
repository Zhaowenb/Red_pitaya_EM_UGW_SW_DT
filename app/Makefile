APP=$(notdir $(CURDIR:%/=%))

BUILD_NUMBER ?= 1
REVISION ?= devbuild
LINUX_VER ?= 2.07
INSTALL_DIR ?= /opt/redpitaya/

CONTROLLERHF=controllerhf.so

.PHONY: all clean test
all:
	$(MAKE) -C src INSTALL_DIR=$(INSTALL_DIR)

$(CONTROLLERHF):
	$(MAKE) -C src INSTALL_DIR=$(INSTALL_DIR)

test:
	$(CXX) -std=c++20 -Wall -Wextra -pedantic tests/test_waveform.cpp -o tests/test_waveform
	./tests/test_waveform

clean:
	$(MAKE) -C src clean INSTALL_DIR=$(INSTALL_DIR)
	-$(RM) tests/test_waveform
	-$(RM) *.so
