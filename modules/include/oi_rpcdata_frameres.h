#pragma once
#include "oi_rpc.h"

namespace OI { namespace RpcData {
class FrameRes : public ::OI::Rpc::RpcData
{
public:
    std::string sFrame{};
    
    explicit FrameRes (){}
    FrameRes ( const std::string & l_sFrame )
    {
        sFrame = l_sFrame;
        
    }
    ::OI::Base::BytesStream& serialize(::OI::Base::BytesStream& os) const override
    {
        os.WritePb(0, sFrame);
        return os;
    }
    ::OI::Base::BytesStream& deserialize(::OI::Base::BytesStream& os) override
    {
        static constexpr std::array<::OI::Base::PbField, 1> fields = {{
            OI_PB_FIELD(FrameRes, 0, sFrame),
        }};
        std::array<uint8_t, 1> seen{};
        return os.ReadFields(this, fields, seen);
    }
};
}}
