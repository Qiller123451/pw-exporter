"""All chunk types. Import a new chunk module here to register it (see base.py)."""
from .base import (Chunk, AnimChunk, NameBlock, CHUNK_CLASSES, ANIM_CLASSES, KINDS, register, key_of)  # noqa: F401
from . import mesh, skeleton, simple, effects, anims  # noqa: F401  (registers the classes)
from .mesh import MeshChunk, MeshData, Submesh  # noqa: F401
from .skeleton import SkeletonChunk, Bone  # noqa: F401
from .simple import LinkChunk, LightVolumeChunk, PhysCollChunk, SpeedlineChunk, LightChunk  # noqa: F401
from .effects import BillboardChunk, ParticleChunk  # noqa: F401
from .anims import (BoneAnimChunk, Track, MeshAnimChunk, BillboardAnimChunk, BillboardCloud,  # noqa: F401
                    ParticleAnimChunk, SpeedlineAnimChunk)


def chunk_class(type_id):
    return CHUNK_CLASSES.get(type_id)


def anim_class(type_id):
    return ANIM_CLASSES.get(type_id)
