"""Let pytest-homeassistant-custom-component find this repo's integration.

The plugin ships its own `custom_components` package for its test config,
which shadows ours; add this repo's folder to that package's search path.
"""
import os

import custom_components

_HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "custom_components")
if _HERE not in custom_components.__path__:
    custom_components.__path__.insert(0, _HERE)
